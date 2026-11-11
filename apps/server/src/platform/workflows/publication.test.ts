/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies publication requires an activity ownership capability and that its lease  │
 * │ is checked within the transaction. Tests also cover database identity fencing and        │
 * │ rejection metrics.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: missing activity ownership is rejected; publication is fenced within the      │
 * │   transaction by the captured activity lease.                                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/platform/database/context, #server/platform/database/database,              │
 * │ #server/platform/definitions/define-store with real SQLite and application resources;    │
 * │ fixture cleanup closes owned resources.                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { SourceId } from '@study/contracts/ids';
import { eq, sql } from '@study/db';
import { workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Metric, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import {
  defineStore,
  publicationTransaction,
  storeMutation
} from '#server/platform/definitions/define-store';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { PublicationGuard, withPublicationGuard } from '#server/platform/workflows/publication';
import { workflowStore } from '#server/platform/workflows/store';

const guarded = Effect.gen(function* () {
  return yield* PublicationGuard;
});

function publicationTypeAssertions() {
  // @ts-expect-error PublicationGuard must be supplied before running the effect.
  void Effect.runPromise(guarded);
}

void publicationTypeAssertions;

testStable('missing activity ownership is rejected', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());

  try {
    const error = await Effect.runPromise(Effect.flip(withPublicationGuard(context, guarded)));

    assert.ok(error instanceof StudyError);
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable(
  'publication is fenced within the transaction by the captured activity lease',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const store = workflowStore(context);

    context.db.orm.run(sql`CREATE TABLE publication_probe (value INTEGER)`);
    let assertionsCompleted = false;
    const workflow = Workflow.make('publication-test', {
      payload: { id: Schema.String },
      idempotencyKey: ({ id }) => id
    });

    function* verifyPublicationFencing() {
      const guard = yield* PublicationGuard;
      const secondLocation = yield* Effect.promise(() => createTestDatabase());
      const second = new ServerContext(yield* Effect.promise(() => secondLocation.open()));
      const probe = defineStore({
        name: 'test/PublicationProbe',
        entity: { singular: 'probe', plural: 'probes' },
        make: ({ db }) => ({
          queries: {},
          mutations: {
            insert: storeMutation({
              input: Schema.String,
              output: Schema.Void,
              run: (key) => {
                db.orm.run(
                  sql`INSERT INTO preferences(scope,key,value) VALUES('publication-context',${key},'null')`
                );
              }
            })
          }
        })
      });
      let invoked = false;

      const mismatched = publicationTransaction((tx) => {
        invoked = true;
        tx.store(probe).insert('wrong-database');
        tx.emit({
          type: 'SourceDeleted',
          eventId: 'wrong-database-publication',
          causationId: null,
          correlationId: 'wrong-database-publication',
          inputVersion: 1,
          depth: 0,
          sourceId: 1n as SourceId
        });
      });

      try {
        assert.throws(
          () =>
            context.transaction((context) => {
              context.db.orm.run(sql`INSERT INTO publication_probe VALUES (99)`);
              const rejected = Effect.runSync(
                mismatched.pipe(
                  Effect.provideService(PublicationGuard, guard),
                  Effect.provideService(Database, { store: second }),
                  Effect.flip
                )
              );

              assert.ok(rejected.kind === 'cancelled');

              throw new Error('rollback owner database');
            }),
          /rollback owner database/
        );
        assert.ok(invoked === false);
        assert.strictEqual(
          second.db.orm.get(sql`SELECT key FROM preferences WHERE scope='publication-context'`),
          undefined
        );
        assert.strictEqual(
          second.db.orm.get(
            sql`SELECT event_id FROM workflow_events WHERE event_id='wrong-database-publication'`
          ),
          undefined
        );
        assert.strictEqual(context.db.orm.all(sql`SELECT value FROM publication_probe`).length, 0);

        yield* publicationTransaction((tx) => tx.store(probe).insert('same-database')).pipe(
          Effect.provideService(Database, { store: context })
        );
        assert.strictEqual(
          context.db.orm.all(sql`SELECT key FROM preferences WHERE scope='publication-context'`)
            .length,
          1
        );
      } finally {
        second.close();
        yield* Effect.promise(() => secondLocation.cleanup());
      }

      assert.throws(() => guard.assert(context), StudyError);
      context.transaction((context) => {
        guard.assert(context);
        context.db.orm.run(sql`INSERT INTO publication_probe VALUES (1)`);
      });
      store.interrupt('publication', 'safe');
      assert.throws(() => context.transaction((context) => guard.assert(context)), StudyError);
      context.db.orm
        .update(workflow_executions)
        .set({ result: null })
        .where(eq(workflow_executions.execution_id, 'publication'))
        .run();
      context.db.orm
        .update(workflow_executions)
        .set({ status: 'suspended' })
        .where(eq(workflow_executions.execution_id, 'publication'))
        .run();
      assert.throws(() => context.transaction((context) => guard.assert(context)), StudyError);
      context.db.orm
        .update(workflow_executions)
        .set({ status: 'running' })
        .where(eq(workflow_executions.execution_id, 'publication'))
        .run();
      context.db.orm
        .update(workflow_executions)
        .set({ updated_at: 0n })
        .where(eq(workflow_executions.execution_id, 'publication'))
        .run();
      assert.throws(() => context.transaction((context) => guard.assert(context)), StudyError);
      assert.ok(store.claim('publication', 'replacement') === true);
      assert.throws(() => context.transaction((context) => guard.assert(context)), StudyError);
      assert.throws(
        () =>
          context.transaction((context) => {
            context.db.orm.run(sql`INSERT INTO publication_probe VALUES (2)`);
            guard.assert(context);
          }),
        StudyError
      );
      assert.strictEqual(context.db.orm.all(sql`SELECT value FROM publication_probe`).length, 1);
      context.db.orm
        .delete(workflow_executions)
        .where(eq(workflow_executions.execution_id, 'publication'))
        .run();
      assert.throws(() => context.transaction((context) => guard.assert(context)), StudyError);
      assertionsCompleted = true;
    }

    const activity = Activity.make({
      name: 'publish',
      execute: withPublicationGuard(context, Effect.gen(verifyPublicationFencing)).pipe(
        Effect.orDie
      )
    });

    try {
      const metrics = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(workflow, () => activity);
            yield* Effect.exit(
              engine.execute(workflow, {
                executionId: 'publication',
                payload: { id: 'publication' }
              })
            );

            return yield* Metric.snapshot;
          }).pipe(Effect.provide(workflowEngineLayer(context)))
        ).pipe(Effect.provideService(Metric.MetricRegistry, new Map()))
      );

      assert.isTrue(assertionsCompleted);
      const rejected = metrics.find((metric) => metric.id === 'study.publication.rejection');

      assert.ok(rejected?.type === 'Counter');

      if (rejected?.type === 'Counter') assert.strictEqual(rejected.state.count, 8);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
