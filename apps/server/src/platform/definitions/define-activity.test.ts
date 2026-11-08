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

import { failureSchema, StudyError } from '@study/contracts/errors';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Context, Effect, Schema } from 'effect';
import { Workflow, WorkflowEngine } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { defineActivity, publicationActivity } from '#server/platform/definitions/define-activity';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { PublicationGuard } from '#server/platform/workflows/publication';

class Input extends Context.Service<Input, string>()('test/ActivityInput') {}

testStable(
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

    assert.strictEqual(calls, 0);
    assert.strictEqual(activity.name, 'read-value');
    assert.strictEqual(activity.errorSchema, failureSchema);
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

    assert.deepStrictEqual(values, ['saved', 'saved']);
    assert.strictEqual(calls, 1);
  }
);

testStable(
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

    assert.strictEqual(result.kind, 'invalid_input');
    assert.strictEqual(result.message, 'rejected');
  }
);

testStable('publication checkpoints capture the real activity lease inside execution', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
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

      return context.transaction(() => {
        guard.assert(context);

        return ++writes;
      });
    })
  });

  assert.strictEqual(writes, 0);

  try {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);

          return yield* engine.execute(workflow, { executionId: 'one', payload: {} });
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );

    assert.strictEqual(result, 1);
    assert.strictEqual(writes, 1);
  } finally {
    context.close();
    location.cleanup();
  }
});
