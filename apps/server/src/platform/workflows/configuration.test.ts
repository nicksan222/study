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
import { Effect, Layer, Option, Schema, Schedule } from 'effect';
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

function admit(context: ServerContext, tag: string, id: string) {
  context.db.orm
    .insert(workflow_executions)
    .values({
      execution_id: id,
      workflow_tag: tag,
      version: 1,
      payload: '{}',
      status: 'running',
      created_at: 1n,
      updated_at: 1n
    })
    .onConflictDoNothing()
    .run();
}

for (const kind of ['auth', 'config', 'model_unavailable'] as const)
  testStable(
    `${kind} configuration waits survive reopening and retry only when the fingerprint changes`,
    async () => {
      const location = await createTestDatabase();
      let context = new ServerContext(await location.open());
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
          for (let i = 0; i < 1000; i++) {
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
            admit(context, workflow._tag, 'configuration-run');
            yield* engine.execute(workflow, {
              executionId: 'configuration-run',
              payload: { id: 'one' },
              discard: true
            });
            yield* awaitStatus(engine, 'Suspended');
            context.db.orm.update(workflow_executions).set({ status: 'suspended' }).run();
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
        context = new ServerContext(await location.open());
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
        await location.cleanup();
      }
    }
  );

testStable(
  'configuration changes during a failed call are retained, and cancelled waits never retry',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
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
              for (let i = 0; i < 1000; i++) {
                const state = yield* engine.poll(workflow, id);

                if (Option.isSome(state) && state.value._tag === expected) return;

                yield* Effect.sleep('5 millis');
              }

              throw new Error('Workflow did not settle');
            });

          yield* engine.register(workflow, () => retryResumableActivity(activity));
          admit(context, workflow._tag, 'race');
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
          admit(context, workflow._tag, 'cancel');
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
              .find((row) => row.execution_id === 'cancel')?.cancellation_mode === null
          );
        }).pipe(Effect.provide(services), Effect.scoped)
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

for (const kind of ['invalid_input', 'transient'] as const) {
  testStable(
    `${kind} failures respect terminal classification and durable retry limits`,
    async () => {
      const location = await createTestDatabase();
      const context = new ServerContext(await location.open());
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
            admit(context, workflow._tag, 'limit');
            yield* engine.execute(workflow, {
              executionId: 'limit',
              payload: { id: 'limit' },
              discard: true
            });

            for (let i = 0; i < 1000; i++) {
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
        await location.cleanup();
      }
    }
  );
}

testStable(
  'configuration reasons stay correlated to their own execution in detail and lists',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const first = executionIdSchema.make('configuration-first');
    const second = executionIdSchema.make('configuration-second');

    try {
      context.db.orm
        .insert(workflow_executions)
        .values(
          [first, second].map((id) => ({
            execution_id: id,
            workflow_tag: 'configuration-correlation-test',
            version: 1,
            payload: '{}',
            status: 'suspended' as const,
            created_at: 1n,
            updated_at: 1n
          }))
        )
        .run();
      context.db.orm
        .insert(workflow_configuration_waits)
        .values({
          execution_id: first,
          deferred_name: 'setup',
          observed_revision: 'before',
          reason: 'auth'
        })
        .run();

      await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* useStore(ExecutionStore);

          assert.strictEqual((yield* store.execution(first)).configurationWaitReason, 'auth');
          assert.strictEqual((yield* store.execution(second)).configurationWaitReason, null);
          let listed = yield* store.executions({ limit: 10 });

          assert.strictEqual(
            listed.find((row) => row.id === second)?.configurationWaitReason,
            null
          );
          context.db.orm
            .insert(workflow_configuration_waits)
            .values({
              execution_id: second,
              deferred_name: 'setup',
              observed_revision: 'before',
              reason: 'config'
            })
            .run();
          assert.strictEqual((yield* store.execution(first)).configurationWaitReason, 'auth');
          assert.strictEqual((yield* store.execution(second)).configurationWaitReason, 'config');
          listed = yield* store.executions({ limit: 10 });
          assert.strictEqual(
            listed.find((row) => row.id === first)?.configurationWaitReason,
            'auth'
          );
          assert.strictEqual(
            listed.find((row) => row.id === second)?.configurationWaitReason,
            'config'
          );
        }).pipe(Effect.provide(Layer.succeed(Database, { store: context })), Effect.scoped)
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

testStable('configuration revisions cannot exceed the total activity attempt bound', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  let revision = '0';
  let calls = 0;
  const workflow = Workflow.make('configuration-attempt-bound', {
    payload: { id: Schema.String },
    error: failureSchema,
    idempotencyKey: ({ id }) => id
  });

  context.db.orm
    .insert(workflow_executions)
    .values({
      execution_id: 'bounded-config',
      workflow_tag: workflow._tag,
      version: 1,
      payload: '{}',
      status: 'running',
      created_at: 0n,
      updated_at: 0n
    })
    .run();
  const activity = Activity.make({
    name: 'always-needs-setup',
    error: failureSchema,
    execute: Effect.suspend(() => {
      calls++;

      return Effect.fail(new StudyError('config', 'Setup required'));
    })
  });

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine;

        yield* engine.register(workflow, () => retryResumableActivity(activity, { maxRetries: 2 }));
        yield* engine.execute(workflow, {
          executionId: 'bounded-config',
          payload: { id: 'bounded' },
          discard: true
        });

        for (let next = 1; next <= 2; next++) {
          yield* Effect.sync(
            () => context.db.orm.select().from(workflow_configuration_waits).all().length
          ).pipe(
            Effect.repeat({ while: (count) => count === 0, schedule: Schedule.spaced('5 millis') })
          );
          revision = String(next);
          yield* notifyConfigurationChanged(context, engine, revision);
        }

        const reply = yield* engine.poll(workflow, 'bounded-config').pipe(
          Effect.repeat({
            while: (value) => Option.isNone(value) || value.value._tag !== 'Complete',
            schedule: Schedule.spaced('5 millis')
          })
        );

        assert.ok(Option.isSome(reply) && reply.value._tag === 'Complete');
        assert.strictEqual(calls, 3);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            workflowEngineLayer(context),
            Layer.succeed(Database, { store: context }),
            Layer.succeed(WorkflowConfiguration, { revision: Effect.sync(() => revision) })
          )
        ),
        Effect.scoped,
        Effect.timeout('5 seconds')
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('configuration revision changes exhaust the bounded total attempt budget', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  let calls = 0;
  let revision = 'initial';
  const workflow = Workflow.make('bounded-configuration-retries', {
    payload: { id: Schema.String },
    error: failureSchema,
    idempotencyKey: ({ id }) => id
  });

  context.db.orm
    .insert(workflow_executions)
    .values({
      execution_id: 'bounded',
      workflow_tag: workflow._tag,
      version: 1,
      payload: '{}',
      status: 'running',
      created_at: 0n,
      updated_at: 0n
    })
    .run();

  const needsSettings = Effect.suspend(() => {
    calls++;

    return Effect.fail(new StudyError('config', 'Settings needed'));
  });

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () =>
            retryResumableActivity(
              Activity.make({
                name: 'needs-settings',
                error: failureSchema,
                execute: needsSettings
              }),
              { maxRetries: 1 }
            )
          );
          yield* engine.execute(workflow, {
            executionId: 'bounded',
            payload: { id: 'bounded' },
            discard: true
          });
          yield* Effect.sync(() =>
            context.db.orm.select().from(workflow_configuration_waits).get()
          ).pipe(Effect.repeat({ while: (row) => !row, schedule: Schedule.spaced('5 millis') }));
          revision = 'changed';
          yield* notifyConfigurationChanged(context, engine, revision);
          const terminal = yield* engine.poll(workflow, 'bounded').pipe(
            Effect.repeat({
              while: (result) => Option.isNone(result) || result.value._tag !== 'Complete',
              schedule: Schedule.spaced('5 millis')
            })
          );

          assert.ok(Option.isSome(terminal) && terminal.value._tag === 'Complete');
          assert.strictEqual(calls, 2);
          yield* notifyConfigurationChanged(context, engine, 'changed-again');
          assert.strictEqual(calls, 2);
        })
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            workflowEngineLayer(context),
            Layer.succeed(Database, { store: context }),
            Layer.succeed(WorkflowConfiguration, { revision: Effect.sync(() => revision) })
          )
        ),
        Effect.timeout('5 seconds')
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});
