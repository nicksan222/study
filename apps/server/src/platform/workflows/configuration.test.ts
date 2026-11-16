import { failureSchema, StudyError } from '@study/contracts';
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
import { executionIdSchema } from '@study/contracts';
import { eq, sql } from '@study/db';
import { workflow_configuration_waits, workflow_executions } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Option, Schema, Schedule } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

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
  test.stable(
    `${kind} configuration waits survive reopening and retry only when the fingerprint changes`,
    async ({ databases }) => {
      const location = await databases();
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
        test
          .pollUntil(
            engine.poll(workflow, 'configuration-run'),
            (state) => Option.isSome(state) && state.value._tag === expected,
            { attempts: 1000, interval: '5 millis', message: `Workflow did not reach ${expected}` }
          )
          .pipe(Effect.map((state) => Option.getOrThrow(state)));

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
            test.assert.strictEqual(calls, 1);
            test.assert.throws(() =>
              context.db.orm.run(
                sql`UPDATE workflow_configuration_waits SET reason = ${'unknown-reason'}`
              )
            );
            test.assert.strictEqual(
              context.db.orm.select().from(workflow_configuration_waits).get()?.reason,
              kind
            );
            test.assert.strictEqual(
              yield* notifyConfigurationChanged(context, engine, revision),
              0
            );
            test.assert.strictEqual(calls, 1);
            test.assert.strictEqual(
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
            test.assert.strictEqual((yield* store.execution(id)).configurationWaitReason, null);
            context.db.orm.update(workflow_configuration_waits).set({ reason: kind }).run();
            context.db.orm
              .insert(workflow_configuration_waits)
              .values({ execution_id: id, deferred_name: 'legacy', observed_revision: 'before' })
              .run();
            test.assert.strictEqual((yield* store.execution(id)).configurationWaitReason, kind);
            context.db.orm
              .delete(workflow_configuration_waits)
              .where(eq(workflow_configuration_waits.deferred_name, 'legacy'))
              .run();
            test.assert.strictEqual((yield* store.execution(id)).configurationWaitReason, kind);
            test.assert.strictEqual(
              (yield* store.executions({ limit: 10 }))[0]?.configurationWaitReason,
              kind
            );

            yield* engine.register(workflow, () => retryResumableActivity(activity));
            test.assert.strictEqual(
              yield* notifyConfigurationChanged(context, engine, revision),
              1
            );
            const complete = yield* awaitStatus(engine, 'Complete');

            test.assert.ok(complete._tag === 'Complete');
            test.assert.strictEqual(calls, 2);
            test.assert.strictEqual((yield* store.execution(id)).configurationWaitReason, null);
            test.assert.strictEqual(
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

test.stable(
  'configuration changes during a failed call are retained, and cancelled waits never retry',
  async ({ databases }) => {
    const location = await databases();
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
            test
              .pollUntil(
                engine.poll(workflow, id),
                (state) => Option.isSome(state) && state.value._tag === expected,
                { attempts: 1000, interval: '5 millis', message: 'Workflow did not settle' }
              )
              .pipe(Effect.asVoid);

          yield* engine.register(workflow, () => retryResumableActivity(activity));
          admit(context, workflow._tag, 'race');
          yield* engine.execute(workflow, {
            executionId: 'race',
            payload: { id: 'race' },
            discard: true
          });
          yield* wait('race', 'Suspended');
          ready = true;
          test.assert.strictEqual(yield* notifyConfigurationChanged(context, engine, revision), 1);
          yield* wait('race', 'Complete');
          test.assert.strictEqual(calls, 2);

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
          test.assert.strictEqual(calls, 3);
          test.assert.strictEqual(
            context.db.orm.select().from(workflow_configuration_waits).all().length,
            0
          );
          test.assert.ok(
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
  test.stable(
    `${kind} failures respect terminal classification and durable retry limits`,
    async ({ databases }) => {
      const location = await databases();
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

            yield* test.pollUntil(
              engine.poll(workflow, 'limit'),
              (state) => Option.isSome(state) && state.value._tag === 'Complete',
              { attempts: 1000, interval: '5 millis', message: 'Workflow did not complete' }
            );
            test.assert.strictEqual(calls, kind === 'transient' ? 3 : 1);
          }).pipe(Effect.provide(services), Effect.scoped)
        );
      } finally {
        context.close();
        await location.cleanup();
      }
    }
  );
}

test.stable(
  'configuration reasons stay correlated to their own execution in detail and lists',
  async ({ databases }) => {
    const location = await databases();
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

          test.assert.strictEqual((yield* store.execution(first)).configurationWaitReason, 'auth');
          test.assert.strictEqual((yield* store.execution(second)).configurationWaitReason, null);
          let listed = yield* store.executions({ limit: 10 });

          test.assert.strictEqual(
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
          test.assert.strictEqual((yield* store.execution(first)).configurationWaitReason, 'auth');
          test.assert.strictEqual(
            (yield* store.execution(second)).configurationWaitReason,
            'config'
          );
          listed = yield* store.executions({ limit: 10 });
          test.assert.strictEqual(
            listed.find((row) => row.id === first)?.configurationWaitReason,
            'auth'
          );
          test.assert.strictEqual(
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

test.stable(
  'configuration revisions cannot exceed the total activity attempt bound',
  async ({ databases }) => {
    const location = await databases();
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

          yield* engine.register(workflow, () =>
            retryResumableActivity(activity, { maxRetries: 2 })
          );
          yield* engine.execute(workflow, {
            executionId: 'bounded-config',
            payload: { id: 'bounded' },
            discard: true
          });

          for (let next = 1; next <= 2; next++) {
            yield* Effect.sync(
              () => context.db.orm.select().from(workflow_configuration_waits).all().length
            ).pipe(
              Effect.repeat({
                while: (count) => count === 0,
                schedule: Schedule.spaced('5 millis')
              })
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

          test.assert.ok(Option.isSome(reply) && reply.value._tag === 'Complete');
          test.assert.strictEqual(calls, 3);
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
  }
);

test.stable(
  'configuration revision changes exhaust the bounded total attempt budget',
  async ({ databases }) => {
    const location = await databases();
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

            test.assert.ok(Option.isSome(terminal) && terminal.value._tag === 'Complete');
            test.assert.strictEqual(calls, 2);
            yield* notifyConfigurationChanged(context, engine, 'changed-again');
            test.assert.strictEqual(calls, 2);
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
  }
);

test.stable(
  'local AI saturation uses durable waits without exhausting provider retry budget',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    let attempts = 0;
    const workflow = Workflow.make('capacity-wait-test', {
      payload: { id: Schema.String },
      success: Schema.Number,
      error: failureSchema,
      idempotencyKey: ({ id }) => id
    });
    const activity = Activity.make({
      name: 'capacity-operation',
      success: Schema.Number,
      error: failureSchema,
      execute: Effect.suspend(() =>
        ++attempts <= 5
          ? Effect.fail(
              new StudyError('rate_limited', 'Capacity full', { resource: 'ai_capacity' })
            )
          : Effect.succeed(attempts)
      )
    });
    const runtime = (await import('effect')).ManagedRuntime.make(
      workflow
        .toLayer(() => retryResumableActivity(activity, { maxRetries: 0, delayMs: 1 }))
        .pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              workflowEngineLayer(context),
              Layer.succeed(Database, { store: context }),
              Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('capacity') })
            )
          )
        )
    );

    try {
      admit(context, workflow._tag, 'capacity');
      const result = await runtime.runPromise(
        WorkflowEngine.WorkflowEngine.use((engine) =>
          engine.execute(workflow, { executionId: 'capacity', payload: { id: 'capacity' } })
        )
      );

      test.assert.strictEqual(result, 6);
      test.assert.strictEqual(attempts, 6);
    } finally {
      await runtime.dispose();
      context.close();
      await location.cleanup();
    }
  }
);
