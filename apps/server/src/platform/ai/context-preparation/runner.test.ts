/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies bounded native processing preserves durable results and current           │
 * │ authority.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises deterministic reduction budgets and cancellation before further work.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real workflow engines own all Activity checkpoints and execution replay behavior.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunCrypto } from '@effect/platform-bun';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { failureSchema, StudyError } from '@study/contracts';
import { contentInputSchema } from '@study/contracts';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema, Layer, ManagedRuntime, Option, Schedule } from 'effect';
import { ClusterWorkflowEngine, SingleRunner } from 'effect/cluster';
import { Workflow, WorkflowEngine, DurableDeferred } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { resumableActivity } from '#server/platform/definitions/define-activity';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';

import type { ContextReductionLimits, ReductionContext } from './index.ts';
import { planSourcePassages } from './planner.ts';
import { processSourcePassages } from './runner.ts';
import { document } from './test-helpers.ts';

const referenceSchema = Schema.String;

const limits: ContextReductionLimits = {
  maxResultBytes: 1000,
  maxReductionBytes: 2000,
  maxFanout: 2,
  maxLevels: 8
};

const makePlan = () =>
  planSourcePassages({
    documents: [{ key: 'one', name: 'Exact', reference: 'v1', document: document(['abcde']) }],
    referenceSchema,
    limits: {
      maxPieceChars: 1,
      maxPassageChars: 1,
      maxPieceBytes: 1000,
      maxPlanChars: 100,
      maxPlanBytes: 10000,
      maxPieces: 10
    },
    selection: { mode: 'complete' }
  });

type ProcessingServices = Effect.Services<
  ReturnType<typeof processSourcePassages<string, string, never>>
>;

async function run<A, E>(
  execute: Effect.Effect<A, E, ProcessingServices>,
  schema: Schema.Codec<A, unknown>
) {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const workflow = Workflow.make('DocumentRunnerTest', {
    payload: {},
    success: schema,
    error: failureSchema,
    idempotencyKey: () => 'one'
  });

  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () =>
            execute.pipe(
              Effect.mapError(() => new StudyError('internal', 'Unexpected test failure'))
            )
          );

          return yield* engine.execute(workflow, { executionId: 'one', payload: {} });
        }).pipe(
          Effect.provideService(Database, { store: context }),
          Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('fixed') }),
          Effect.provide(WorkflowEngine.layerMemory)
        )
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
}

testStable('maps all pieces and reduces in deterministic bounded levels', async () => {
  const events: string[] = [];
  let preflights = 0;
  const execute = processSourcePassages({
    name: 'test',
    referenceSchema,
    mappedSchema: Schema.String,
    plan: makePlan(),
    limits,
    preflight: Effect.sync(() => {
      preflights++;
    }),
    map: (piece) =>
      Effect.sync(() => {
        events.push(`map:${piece.index}`);

        return piece.passages.map((p) => p.text).join('');
      }),
    reduce: (values, context: ReductionContext) =>
      Effect.sync(() => {
        events.push(`reduce:${context.level}:${context.index}`);

        return values.join('');
      })
  }).pipe(Effect.map((r) => r.value));

  assert.equal(await run(execute, Schema.String), 'abcde');
  assert.deepEqual(events, [
    'map:0',
    'map:1',
    'map:2',
    'map:3',
    'map:4',
    'reduce:0:0',
    'reduce:0:1',
    'reduce:0:2',
    'reduce:1:0',
    'reduce:1:1',
    'reduce:2:0'
  ]);
  assert.equal(preflights, 25);
});

testStable(
  'rejects oversized serialized output and cancellation before further units',
  async () => {
    let mapped = 0;
    const execute = processSourcePassages({
      name: 'test',
      referenceSchema,
      mappedSchema: Schema.String,
      plan: makePlan(),
      limits: { ...limits, maxResultBytes: 3 },
      preflight: Effect.void,
      map: () =>
        Effect.sync(() => {
          mapped++;

          return '🌏';
        }),
      reduce: () => Effect.succeed('x')
    }).pipe(
      Effect.flip,
      Effect.map((e) => e.kind)
    );

    assert.equal(await run(execute, Schema.String), 'not_enough');
    assert.equal(mapped, 1);
    mapped = 0;
    const cancelled = processSourcePassages({
      name: 'test',
      referenceSchema,
      mappedSchema: Schema.String,
      plan: makePlan(),
      limits,
      preflight: Effect.suspend(() =>
        mapped ? Effect.fail(new StudyError('cancelled', 'Stopped')) : Effect.void
      ),
      map: () =>
        Effect.sync(() => {
          mapped++;

          return 'x';
        }),
      reduce: () => Effect.succeed('x')
    }).pipe(
      Effect.flip,
      Effect.map((e) => e.kind)
    );

    assert.equal(await run(cancelled, Schema.String), 'cancelled');
    assert.equal(mapped, 1);
  }
);

testStable(
  'official SQLite restart and outer retry preserve child maps and completed outer replies',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const workflow = Workflow.make('SourcePassageGroupsRestartProofV1', {
      payload: { id: Schema.String },
      success: Schema.String,
      error: failureSchema,
      idempotencyKey: ({ id }) => id
    });
    const gate = DurableDeferred.make('after-first-map');
    const finalGate = DurableDeferred.make('after-outer-result');
    const maps = new Map<number, number>();
    let planCalls = 0,
      outerCalls = 0,
      reductions = 0;
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
    const requestedLimits = { ...limits };
    const processing = processSourcePassages({
      name: 'restart-proof',
      referenceSchema,
      mappedSchema: Schema.String,
      plan: makePlan().pipe(
        Effect.tap(
          Effect.sync(() => {
            planCalls++;
          })
        )
      ),
      limits: requestedLimits,
      preflight: Effect.void,
      map: (piece) =>
        Effect.gen(function* () {
          if (piece.index === 1) yield* DurableDeferred.await(gate);

          maps.set(piece.index, (maps.get(piece.index) ?? 0) + 1);

          return piece.passages.map((p) => p.text).join('');
        }),
      reduce: (values) =>
        Effect.sync(() => {
          reductions++;

          return values.join('');
        })
    });
    const outer = (changed: boolean) =>
      Effect.gen(function* () {
        outerCalls++;

        if (changed) return yield* Effect.die(new Error('Completed outer reply was not reused'));

        const result = yield* processing;

        if (outerCalls === 2)
          return yield* Effect.fail(new StudyError('transient', 'Retry outer operation'));

        return result.value;
      });
    const body = (changed: boolean) =>
      Effect.gen(function* () {
        const value = yield* resumableActivity(
          { name: 'generate-material-1', success: Schema.String, execute: outer(changed) },
          { delayMs: 1 }
        );

        yield* DurableDeferred.await(finalGate);

        return value;
      }).pipe(
        Effect.provideService(Database, { store: context }),
        Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('fixed') })
      );
    const build = (changed = false) =>
      workflow.toLayer(() => body(changed)).pipe(Layer.provideMerge(base));
    const wait = (id: string, ready: () => boolean) =>
      workflow.poll(id).pipe(
        Effect.repeat({
          while: (result) => Option.isNone(result) || result.value._tag !== 'Suspended' || !ready(),
          schedule: Schedule.spaced('5 millis')
        }),
        Effect.timeout('10 seconds')
      );
    const first = ManagedRuntime.make(build());

    try {
      const id = await first.runPromise(workflow.execute({ id: 'accepted' }, { discard: true }));

      await first.runPromise(wait(id, () => maps.size === 1));
      assert.equal(maps.get(0), 1);
      await first.dispose();
      const second = ManagedRuntime.make(build());

      try {
        await second.runPromise(
          DurableDeferred.succeed(gate, {
            token: DurableDeferred.tokenFromExecutionId(gate, { workflow, executionId: id }),
            value: undefined
          })
        );
        await second.runPromise(wait(id, () => outerCalls >= 3 && reductions === 6));
        assert.equal(planCalls, 1);
        assert.equal(maps.size, 5);
        assert.deepEqual([...maps.values()], [1, 1, 1, 1, 1]);
        await second.dispose();
        const third = ManagedRuntime.make(build(true));

        try {
          await third.runPromise(
            DurableDeferred.succeed(finalGate, {
              token: DurableDeferred.tokenFromExecutionId(finalGate, { workflow, executionId: id }),
              value: undefined
            })
          );
          assert.equal(
            await third.runPromise(
              workflow.execute({ id: 'accepted' }).pipe(Effect.timeout('10 seconds'))
            ),
            'abcde'
          );
          assert.equal(outerCalls, 3);
          assert.equal(planCalls, 1);
          assert.equal(reductions, 6);
        } finally {
          await third.dispose();
        }
      } finally {
        await second.dispose();
      }
    } finally {
      await first.dispose();
      context.close();
      await location.cleanup();
    }
  }
);

testStable('rejects reduction input overflow and finite-depth exhaustion', async () => {
  let reductions = 0;
  const execute = (budget: typeof limits) =>
    processSourcePassages({
      name: 'test',
      referenceSchema,
      mappedSchema: Schema.String,
      plan: makePlan(),
      limits: budget,
      preflight: Effect.void,
      map: () => Effect.succeed('x'),
      reduce: () =>
        Effect.sync(() => {
          reductions++;

          return 'x';
        })
    }).pipe(
      Effect.flip,
      Effect.map((error) => error.kind)
    );

  assert.equal(
    await run(execute({ ...limits, maxReductionBytes: 1 }), Schema.String),
    'not_enough'
  );
  assert.equal(reductions, 0);
  assert.equal(await run(execute({ ...limits, maxLevels: 1 }), Schema.String), 'not_enough');
  assert.equal(reductions, 3);
  reductions = 0;
  assert.equal(await run(execute({ ...limits, maxFanout: 1 }), Schema.String), 'invalid_input');
  assert.equal(reductions, 0);
});

testStable('checks authority again before returning a completed single piece', async () => {
  let finished = false;
  const onePiece = planSourcePassages({
    documents: [{ key: 'one', name: 'Exact', reference: 'v1', document: document(['one']) }],
    referenceSchema,
    limits: {
      maxPieceChars: 100,
      maxPassageChars: 100,
      maxPieceBytes: 1000,
      maxPlanChars: 100,
      maxPlanBytes: 10000,
      maxPieces: 10
    },
    selection: { mode: 'complete' }
  });
  const execute = processSourcePassages({
    name: 'test',
    referenceSchema,
    mappedSchema: Schema.String,
    plan: onePiece,
    limits,
    preflight: Effect.suspend(() =>
      finished ? Effect.fail(new StudyError('cancelled', 'Current authority revoked')) : Effect.void
    ),
    map: () =>
      Effect.sync(() => {
        finished = true;

        return 'done';
      }),
    reduce: () => Effect.die(new Error('A single piece must bypass reduction'))
  }).pipe(
    Effect.flip,
    Effect.map((error) => error.kind)
  );

  assert.equal(await run(execute, Schema.String), 'cancelled');
});

testStable(
  'persists feature bigint reference and mapped schemas through native Activities',
  async () => {
    const exact = Schema.decodeUnknownSync(contentInputSchema)({
      kind: 'source',
      sourceId: 1n,
      revision: 2n,
      snapshotId: 3n
    });
    const plan = planSourcePassages({
      documents: [
        { key: 'exact', name: 'Original', reference: exact, document: document(['original']) }
      ],
      referenceSchema: contentInputSchema,
      limits: {
        maxPieceChars: 100,
        maxPassageChars: 100,
        maxPieceBytes: 1000,
        maxPlanChars: 100,
        maxPlanBytes: 10000,
        maxPieces: 10
      },
      selection: { mode: 'complete' }
    });
    const execute = processSourcePassages({
      name: 'test',
      referenceSchema: contentInputSchema,
      mappedSchema: contentInputSchema,
      plan,
      limits,
      preflight: Effect.void,
      map: () => Effect.succeed(exact),
      reduce: () => Effect.succeed(exact)
    }).pipe(
      Effect.map((result) => ({
        value: result.value,
        reference: result.plan.pieces[0]!.passages[0]!.reference
      }))
    );

    assert.deepEqual(
      await run(
        execute,
        Schema.Struct({ value: contentInputSchema, reference: contentInputSchema })
      ),
      { value: exact, reference: exact }
    );
  }
);
