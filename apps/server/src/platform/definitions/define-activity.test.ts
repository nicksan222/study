import { failureSchema, StudyError } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies native activity harness replay, lazy dependencies and typed failures.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises checkpoint reuse and canonical failures against the native workflow engine.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the real in-memory Effect Workflow engine without application resources.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Context, Effect, Schema } from 'effect';
import { Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import {
  defineActivity,
  publicationActivity,
  resumableActivity
} from '#server/platform/definitions/define-activity';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { PublicationGuard } from '#server/platform/workflows/publication';
import { admitTestExecution } from '#testing/workflow-admission';

class Input extends Context.Service<Input, string>()('test/ActivityInput') {}

test.stable(
  'activity harness keeps native replay identity and lazy generator requirements',
  async () => {
    let calls = 0;
    const activity = defineActivity({
      name: 'read-value',
      success: Schema.String,
      execute: function* () {
        const input = yield* Input;

        calls++;

        return input;
      }
    });
    const workflow = Workflow.make('harness-replay', {
      payload: {},
      success: Schema.String,
      error: failureSchema,
      idempotencyKey: () => 'one'
    });

    test.assert.strictEqual(calls, 0);
    test.assert.strictEqual(activity.name, 'read-value');
    test.assert.strictEqual(activity.errorSchema, failureSchema);
    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);
          const first = yield* engine.execute(workflow, { executionId: 'one', payload: {} });
          const second = yield* engine.execute(workflow, { executionId: 'one', payload: {} });

          return [first, second];
        }).pipe(Effect.provideService(Input, 'saved'), Effect.provide(WorkflowEngine.layerMemory))
      )
    );

    test.assert.deepStrictEqual(values, ['saved', 'saved']);
    test.assert.strictEqual(calls, 1);
  }
);

test.stable(
  'activity harness preserves the canonical failure kind on the native error channel',
  async () => {
    const failure = new StudyError('invalid_input', 'rejected');
    const activity = defineActivity({
      name: 'reject',
      success: Schema.String,
      execute: Effect.fail(failure)
    });
    const workflow = Workflow.make('harness-failure', {
      payload: {},
      success: Schema.String,
      error: failureSchema,
      idempotencyKey: () => 'one'
    });
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);

          return yield* engine
            .execute(workflow, { executionId: 'one', payload: {} })
            .pipe(Effect.flip);
        }).pipe(Effect.provide(WorkflowEngine.layerMemory))
      )
    );

    test.assert.strictEqual(result.kind, 'invalid_input');
    test.assert.strictEqual(result.message, 'rejected');
  }
);

test.stable(
  'publication activities capture real domain authorization inside execution',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    let writes = 0;
    const workflow = Workflow.make('publication-harness', {
      payload: {},
      success: Schema.Number,
      error: failureSchema,
      idempotencyKey: () => 'one'
    });
    const activity = publicationActivity(context, {
      name: 'publish',
      success: Schema.Number,
      execute: Effect.gen(function* () {
        const guard = yield* PublicationGuard;

        return context.transaction(['settings'], (context) => {
          guard.assert(context);

          return ++writes;
        });
      })
    });

    test.assert.strictEqual(writes, 0);

    try {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(workflow, () => activity);

            admitTestExecution(context, workflow, 'one', {});

            return yield* engine.execute(workflow, { executionId: 'one', payload: {} });
          }).pipe(Effect.provide(workflowEngineLayer(context)))
        )
      );

      test.assert.strictEqual(result, 1);
      test.assert.strictEqual(writes, 1);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'resumable checkpoint keeps terminal failures and honors a zero retry budget',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    let calls = 0;
    const workflow = Workflow.make('resumable-harness', {
      payload: {},
      success: Schema.String,
      error: failureSchema,
      idempotencyKey: () => 'one'
    });
    const activity = resumableActivity(
      {
        name: 'bounded',
        success: Schema.String,
        execute: function* () {
          calls++;

          return yield* Effect.fail(new StudyError('transient', 'retry budget exhausted'));
        }
      },
      { maxRetries: 0 }
    );

    try {
      const error = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(workflow, () => activity);

            return yield* engine
              .execute(workflow, { executionId: 'one', payload: {} })
              .pipe(Effect.flip);
          }).pipe(
            Effect.provideService(Database, { store: context }),
            Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('fixed') }),
            Effect.provide(WorkflowEngine.layerMemory)
          )
        )
      );

      test.assert.strictEqual(error.kind, 'transient');
      test.assert.strictEqual(calls, 1);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
