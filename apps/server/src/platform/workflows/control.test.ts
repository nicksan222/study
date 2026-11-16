import { executionIdSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises native runtime control behavior through real persistence boundaries.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies unsafe control interrupts a provider fiber after its durable source capture   │
 * │   was retired and scrubbed.                                                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { workflow_executions } from '@study/db';
import { test } from '@study/testing';
import { Deferred, Effect, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';

import { cancelExecution } from './control.ts';
import { workflowEngineLayer } from './engine.ts';
import { workflowStore } from './store.ts';

test.stable(
  'explicit cancellation waits for local provider cleanup before terminal domain state',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    const context = new ServerContext(await location.open());
    const id = executionIdSchema.make('cancel-provider');
    const workflow = Workflow.make('StudyControlProofV1', {
      payload: { id: Schema.String },
      idempotencyKey: (p) => p.id
    });

    context.db.orm
      .insert(workflow_executions)
      .values({
        execution_id: id,
        workflow_tag: workflow._tag,
        version: 1,
        payload: '{}',
        status: 'running',
        created_at: 1n,
        updated_at: 1n
      })
      .run();
    let cleaned = false;

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;
            const started = yield* Deferred.make<void>();
            const cleanup = Effect.sync(() => {
              cleaned = true;
            });
            const provider = Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(cleanup)
            );

            yield* engine.register(workflow, () =>
              Activity.make({ name: 'provider', execute: provider })
            );
            yield* engine.execute(workflow, { executionId: id, payload: { id }, discard: true });
            yield* Deferred.await(started);
            yield* cancelExecution(context, [workflow], { id, mode: 'unsafe' });
            assert.isTrue(cleaned);
            assert.equal(workflowStore(context).execution(id)?.status, 'cancelled');
            yield* cancelExecution(context, [workflow], { id, mode: 'unsafe' });
          })
        ).pipe(Effect.provide(workflowEngineLayer(context)))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
