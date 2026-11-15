/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises official SQLite acceptance, recovery, durable waits and explicit         │
 * │ interruption.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies official persistence and scoped lifecycle boundaries.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real SQLite files and official runtime layers without a substitute execution        │
 * │ engine.                                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunCrypto } from '@effect/platform-bun';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { spawnTestProcess } from '@study/testing/process';
import { testStable } from '@study/testing/vitest';
import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Option, Schedule, Schema } from 'effect';
import { ClusterWorkflowEngine, SingleRunner } from 'effect/cluster';
import { SqlClient } from 'effect/sql';
import { Activity, DurableClock, DurableDeferred, Workflow } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { crashLayer, crashWorkflow } from '#testing/official-crash-runner';

testStable(
  'official SQL engine preserves accepted work, activity replies and durable waits across restart',
  async () => {
    const location = await createTestDatabase();

    await location.prepare();
    let calls = 0;
    const count = () => ++calls;
    const workflow = Workflow.make('StudyOfficialPersistenceProofV1', {
      payload: { id: Schema.String },
      success: Schema.Number,
      idempotencyKey: ({ id }) => id
    });
    const base = ClusterWorkflowEngine.layer.pipe(
      Layer.provide(
        SingleRunner.layer({
          runnerStorage: 'memory',
          shardingConfig: {
            shardsPerGroup: 1,
            entityMessagePollInterval: '10 millis',
            entityReplyPollInterval: '10 millis'
          }
        })
      ),
      Layer.provide(SqliteClient.layer({ filename: location.path })),
      Layer.provide(BunCrypto.layer)
    );
    const gate = DurableDeferred.make('wait');
    const layer = workflow
      .toLayer(() =>
        Effect.gen(function* () {
          const result = yield* Activity.make({
            name: 'record',
            success: Schema.Number,
            execute: Effect.sync(count)
          });

          yield* DurableDeferred.await(gate);

          return result;
        })
      )
      .pipe(Layer.provideMerge(base));
    const first = ManagedRuntime.make(layer);

    try {
      const id = await first.runPromise(workflow.execute({ id: 'accepted' }, { discard: true }));

      assert.isString(id);
      await first.runPromise(
        workflow.poll(id).pipe(
          Effect.repeat({
            while: (result) => Option.isNone(result) || result.value._tag !== 'Suspended',
            schedule: Schedule.spaced('5 millis')
          }),
          Effect.timeoutOrElse({
            duration: '5 seconds',
            orElse: () =>
              Effect.die(
                new Error('Workflow did not reach Suspended before restart within 5 seconds')
              )
          })
        )
      );
      assert.equal(calls, 1);
      await first.dispose();
      const second = ManagedRuntime.make(layer);

      try {
        await second.runPromise(
          DurableDeferred.succeed(gate, {
            token: DurableDeferred.tokenFromExecutionId(gate, { workflow, executionId: id }),
            value: undefined
          })
        );
        assert.equal(await second.runPromise(workflow.execute({ id: 'accepted' })), 1);
        assert.equal(calls, 1);
      } finally {
        await second.dispose();
      }

      const third = ManagedRuntime.make(layer);

      try {
        assert.equal(await third.runPromise(workflow.execute({ id: 'accepted' })), 1);
        assert.equal(calls, 1);
      } finally {
        await third.dispose();
      }
    } finally {
      await first.dispose();
      await location.cleanup();
    }
  }
);

testStable(
  'official interruption persists across reopening and does not run a cancelled activity',
  async () => {
    const location = await createTestDatabase();

    await location.prepare();
    let calls = 0;
    const count = () => ++calls;
    const workflow = Workflow.make('StudyOfficialCancellationProofV1', {
      payload: { id: Schema.String },
      success: Schema.Number,
      idempotencyKey: ({ id }) => id
    });
    const base = ClusterWorkflowEngine.layer.pipe(
      Layer.provide(
        SingleRunner.layer({ runnerStorage: 'memory', shardingConfig: { shardsPerGroup: 1 } })
      ),
      Layer.provide(SqliteClient.layer({ filename: location.path })),
      Layer.provide(BunCrypto.layer)
    );
    const layer = workflow
      .toLayer(() =>
        Effect.gen(function* () {
          yield* DurableClock.sleep({
            name: 'before-external',
            duration: '1 hour',
            inMemoryThreshold: 0
          });

          return yield* Activity.make({
            name: 'external',
            success: Schema.Number,
            execute: Effect.sync(count)
          });
        })
      )
      .pipe(Layer.provideMerge(base));
    const first = ManagedRuntime.make(layer);

    try {
      const id = await first.runPromise(workflow.execute({ id: 'cancel' }, { discard: true }));

      await first.runPromise(workflow.interrupt(id));
      await first.dispose();
      const second = ManagedRuntime.make(layer);

      try {
        const result = await second.runPromise(Effect.exit(workflow.execute({ id: 'cancel' })));

        assert.equal(result._tag, 'Failure');
        assert.equal(calls, 0);
      } finally {
        await second.dispose();
      }
    } finally {
      await first.dispose();
      await location.cleanup();
    }
  }
);

testStable(
  'SIGKILL after official acceptance before receipt acknowledgment safely redelivers without repeating persisted activity',
  async () => {
    const location = await createTestDatabase();
    const db = await location.open();

    db.orm.run(sql`CREATE TABLE proof_calls (id INTEGER PRIMARY KEY)`);
    const child = spawnTestProcess(
      [
        process.execPath,
        new URL('../../../test/testing/official-crash-runner.ts', import.meta.url).pathname,
        location.path
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    );

    try {
      const reader = child.stdout.getReader();
      const first = await reader.read();

      assert.include(new TextDecoder().decode(first.value), 'accepted-before-domain-ack');
      child.kill('SIGKILL');
      await child.exited;
      reader.releaseLock();
      const runtime = ManagedRuntime.make(crashLayer(location.path));

      try {
        assert.equal(
          await runtime.runPromise(crashWorkflow.execute({ id: 'accepted-before-ack' })),
          1
        );
        assert.equal(
          db.orm.all<{ count: bigint }>(sql`SELECT count(*) AS count FROM proof_calls`)[0].count,
          1n
        );
      } finally {
        await runtime.dispose();
      }
    } finally {
      child.kill();
      await child.exited;
      db.close();
      await location.cleanup();
    }
  }
);

testStable(
  'official SQL writer and domain writer contend on the same SQLite file and release transaction locks',
  async () => {
    const location = await createTestDatabase();
    const db = await location.open();

    db.orm.run(sql`CREATE TABLE proof_contention (id INTEGER PRIMARY KEY)`);
    db.orm.run(sql`PRAGMA busy_timeout=1`);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* SqlClient.SqlClient;
          const held = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const writer = yield* client
            .withTransaction(
              Effect.gen(function* () {
                yield* client`INSERT INTO proof_contention VALUES (1)`;
                yield* Deferred.succeed(held, undefined);
                yield* Deferred.await(release);
              })
            )
            .pipe(Effect.forkChild);

          yield* Deferred.await(held);
          assert.throws(() => db.orm.run(sql`INSERT INTO proof_contention VALUES (2)`));
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(writer);
          db.orm.run(sql`INSERT INTO proof_contention VALUES (2)`);
          assert.equal(db.orm.all(sql`SELECT * FROM proof_contention`).length, 2);
        }).pipe(Effect.provide(SqliteClient.layer({ filename: location.path })), Effect.scoped)
      );
    } finally {
      db.close();
      await location.cleanup();
    }
  }
);
