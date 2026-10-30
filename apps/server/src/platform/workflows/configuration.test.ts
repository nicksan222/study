import assert from 'node:assert/strict';
import { test } from 'node:test';

import { failureSchema, StudyError } from '@study/contracts/errors';
import { workflow_configuration_waits, workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import {
  notifyConfigurationChanged,
  WorkflowConfiguration
} from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { retryResumableActivity } from '#server/platform/workflows/retry';

test('configuration waits survive reopening and retry only when the fingerprint changes', async () => {
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

        if (revision === 'before') throw new StudyError('auth', 'Sign-in required');

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
        assert.equal(calls, 1);
        assert.equal(yield* notifyConfigurationChanged(context, engine, revision), 0);
        assert.equal(calls, 1);
        assert.equal(context.db.orm.select().from(workflow_configuration_waits).all().length, 1);
      }).pipe(Effect.provide(services()), Effect.scoped)
    );
    context.close();
    context = new ServerContext(location.open());
    revision = 'after';
    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine;

        yield* engine.register(workflow, () => retryResumableActivity(activity));
        assert.equal(yield* notifyConfigurationChanged(context, engine, revision), 1);
        const complete = yield* awaitStatus(engine, 'Complete');

        assert.equal(complete._tag, 'Complete');
        assert.equal(calls, 2);
        assert.equal(context.db.orm.select().from(workflow_configuration_waits).all().length, 0);
      }).pipe(Effect.provide(services()), Effect.scoped)
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('configuration changes during a failed call are retained, and cancelled waits never retry', async () => {
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
        assert.equal(yield* notifyConfigurationChanged(context, engine, revision), 1);
        yield* wait('race', 'Complete');
        assert.equal(calls, 2);

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
        assert.equal(calls, 3);
        assert.equal(context.db.orm.select().from(workflow_configuration_waits).all().length, 0);
        assert.equal(
          context.db.orm
            .select()
            .from(workflow_executions)
            .all()
            .find((row) => row.execution_id === 'cancel')?.status,
          'cancelled'
        );
      }).pipe(Effect.provide(services), Effect.scoped)
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

for (const kind of ['invalid_input', 'transient'] as const) {
  test(`${kind} failures respect terminal classification and durable retry limits`, async () => {
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
              assert.equal(calls, kind === 'transient' ? 3 : 1);

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
  });
}
