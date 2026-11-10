/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies configuration waits persist across SQLite reopen and retry only after the │
 * │ opaque configuration revision changes. It also exercises changes racing with failures    │
 * │ and cancellation of waiting executions.                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: configuration waits survive reopening and retry only when the fingerprint     │
 * │   changes; configuration changes during a failed call are retained, and cancelled waits  │
 * │   never retry.                                                                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/platform/database/context, #server/platform/database/database,              │
 * │ #server/platform/workflows/configuration with real SQLite and application resources;     │
 * │ fixture cleanup closes owned resources.                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema, StudyError } from '@study/contracts/errors';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { eq, sql } from '@study/db';
import { workflow_configuration_waits, workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Option, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { ExecutionStore } from '#server/features/workflows/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { useStore } from '#server/platform/definitions/define-store';
import {
  notifyConfigurationChanged,
  WorkflowConfiguration
} from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { retryResumableActivity } from '#server/platform/workflows/retry';

for (const kind of ['auth', 'config', 'model_unavailable'] as const)
  testStable(
    `${kind} configuration waits survive reopening and retry only when the fingerprint changes`,
    async () => {
      const location = createTestDatabase();
      let context = new ServerContext(location.open());
      let revision = 'before';
      let calls = 0;
      const workflow = Workflow.make('configuration-retry-test', {
        payload: { id: Schema.String },
        success: Schema.Number,
        error: failureSchema,
        idempotencyKey: ({ id }) => id
      });
      const activity = Activity.make({
        name: 'paid-operation',
        success: Schema.Number,
        error: failureSchema,
        execute: Effect.try({
          try: () => {
            calls++;

            if (revision === 'before') throw new StudyError(kind, 'Setup required');

            return calls;
          },
          catch: (cause) =>
            cause instanceof StudyError
              ? cause
              : new StudyError('internal', 'Unexpected operation failure', { cause })
        })
      });
      const services = () =>
        Layer.mergeAll(
          workflowEngineLayer(context),
          Layer.succeed(Database, { store: context }),
          Layer.succeed(WorkflowConfiguration, { revision: Effect.sync(() => revision) })
        );
      const awaitStatus = (
        engine: WorkflowEngine.WorkflowEngine['Service'],
        expected: 'Suspended' | 'Complete'
      ) =>
        Effect.gen(function* () {
          for (let i = 0; i < 100; i++) {
            const state = yield* engine.poll(workflow, 'configuration-run');

            if (Option.isSome(state) && state.value._tag === expected) return state.value;

            yield* Effect.sleep('5 millis');
          }

          throw new Error(`Workflow did not reach ${expected}`);
        });

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(workflow, () => retryResumableActivity(activity));
            yield* engine.execute(workflow, {
              executionId: 'configuration-run',
              payload: { id: 'one' },
              discard: true
            });
            yield* awaitStatus(engine, 'Suspended');
            assert.strictEqual(calls, 1);
            assert.throws(() =>
              context.db.orm.run(
                sql`UPDATE workflow_configuration_waits SET reason = ${'unknown-reason'}`
              )
            );
            assert.strictEqual(
              context.db.orm.select().from(workflow_configuration_waits).get()?.reason,
              kind
            );
            assert.strictEqual(yield* notifyConfigurationChanged(context, engine, revision), 0);
            assert.strictEqual(calls, 1);
            assert.strictEqual(
              context.db.orm.select().from(workflow_configuration_waits).all().length,
              1
            );
          }).pipe(Effect.provide(services()), Effect.scoped)
        );
        context.close();
        context = new ServerContext(location.open());
        revision = 'after';
        await Effect.runPromise(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;
            const store = yield* useStore(ExecutionStore);
            const id = Schema.decodeUnknownSync(executionIdSchema)('configuration-run');

            context.db.orm.update(workflow_configuration_waits).set({ reason: null }).run();
            assert.strictEqual((yield* store.execution(id)).configurationWaitReason, null);
            context.db.orm.update(workflow_configuration_waits).set({ reason: kind }).run();
            context.db.orm
              .insert(workflow_configuration_waits)
              .values({ execution_id: id, deferred_name: 'legacy', observed_revision: 'before' })
              .run();
            assert.strictEqual((yield* store.execution(id)).configurationWaitReason, kind);
            context.db.orm
              .delete(workflow_configuration_waits)
              .where(eq(workflow_configuration_waits.deferred_name, 'legacy'))
              .run();
            assert.strictEqual((yield* store.execution(id)).configurationWaitReason, kind);
            assert.strictEqual(
              (yield* store.executions({ limit: 10 }))[0]?.configurationWaitReason,
              kind
            );

            yield* engine.register(workflow, () => retryResumableActivity(activity));
            assert.strictEqual(yield* notifyConfigurationChanged(context, engine, revision), 1);
            const complete = yield* awaitStatus(engine, 'Complete');

            assert.ok(complete._tag === 'Complete');
            assert.strictEqual(calls, 2);
            assert.strictEqual((yield* store.execution(id)).configurationWaitReason, null);
            assert.strictEqual(
              context.db.orm.select().from(workflow_configuration_waits).all().length,
              0
            );
          }).pipe(Effect.provide(services()), Effect.scoped)
        );
      } finally {
        context.close();
        location.cleanup();
      }
    }
  );

testStable(
  'configuration changes during a failed call are retained, and cancelled waits never retry',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    let revision = 'before';
    let calls = 0;
    let ready = false;
    const workflow = Workflow.make('configuration-race-test', {
      payload: { id: Schema.String },
      success: Schema.Number,
      error: failureSchema,
      idempotencyKey: ({ id }) => id
    });
    const activity = Activity.make({
      name: 'operation',
      success: Schema.Number,
      error: failureSchema,
      execute: Effect.try({
        try: () => {
          calls++;

          if (!ready) {
            revision = 'changed-during-call';

            throw new StudyError('config', 'Configuration changed');
          }

          return calls;
        },
        catch: () => new StudyError('config', 'Configuration changed')
      })
    });
    const services = Layer.mergeAll(
      workflowEngineLayer(context),
      Layer.succeed(Database, { store: context }),
      Layer.succeed(WorkflowConfiguration, { revision: Effect.sync(() => revision) })
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;
          const wait = (id: string, expected: 'Complete' | 'Suspended') =>
            Effect.gen(function* () {
              for (let i = 0; i < 100; i++) {
                const state = yield* engine.poll(workflow, id);

                if (Option.isSome(state) && state.value._tag === expected) return;

                yield* Effect.sleep('5 millis');
              }

              throw new Error('Workflow did not settle');
            });

          yield* engine.register(workflow, () => retryResumableActivity(activity));
          yield* engine.execute(workflow, {
            executionId: 'race',
            payload: { id: 'race' },
            discard: true
          });
          yield* wait('race', 'Suspended');
          ready = true;
          assert.strictEqual(yield* notifyConfigurationChanged(context, engine, revision), 1);
          yield* wait('race', 'Complete');
          assert.strictEqual(calls, 2);

          ready = false;
          yield* engine.execute(workflow, {
            executionId: 'cancel',
            payload: { id: 'cancel' },
            discard: true
          });
          yield* wait('cancel', 'Suspended');
          yield* engine.interrupt(workflow, 'cancel');
          ready = true;
          revision = 'after-cancellation';
          yield* notifyConfigurationChanged(context, engine, revision);
          yield* wait('cancel', 'Complete');
          assert.strictEqual(calls, 3);
          assert.strictEqual(
            context.db.orm.select().from(workflow_configuration_waits).all().length,
            0
          );
          assert.ok(
            context.db.orm
              .select()
              .from(workflow_executions)
              .all()
              .find((row) => row.execution_id === 'cancel')?.status === 'cancelled'
          );
        }).pipe(Effect.provide(services), Effect.scoped)
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

for (const kind of ['invalid_input', 'transient'] as const) {
  testStable(
    `${kind} failures respect terminal classification and durable retry limits`,
    async () => {
      const location = createTestDatabase();
      const context = new ServerContext(location.open());
      let calls = 0;
      const workflow = Workflow.make(`retry-limit-${kind}`, {
        payload: { id: Schema.String },
        error: failureSchema,
        idempotencyKey: ({ id }) => id
      });
      const activity = Activity.make({
        name: 'failing',
        error: failureSchema,
        execute: Effect.suspend(() => {
          calls++;

          return Effect.fail(new StudyError(kind, 'Expected failure'));
        })
      });
      const services = Layer.mergeAll(
        workflowEngineLayer(context),
        Layer.succeed(Database, { store: context }),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('fixed') })
      );

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(workflow, () =>
              retryResumableActivity(activity, { maxRetries: 2, delayMs: 1 })
            );
            yield* engine.execute(workflow, {
              executionId: 'limit',
              payload: { id: 'limit' },
              discard: true
            });

            for (let i = 0; i < 100; i++) {
              const state = yield* engine.poll(workflow, 'limit');

              if (Option.isSome(state) && state.value._tag === 'Complete') {
                assert.strictEqual(calls, kind === 'transient' ? 3 : 1);

                return;
              }

              yield* Effect.sleep('5 millis');
            }

            throw new Error('Workflow did not complete');
          }).pipe(Effect.provide(services), Effect.scoped)
        );
      } finally {
        context.close();
        location.cleanup();
      }
    }
  );
}
