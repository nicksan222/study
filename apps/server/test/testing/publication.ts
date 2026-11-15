/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs test publication mutations under real native Workflow activity ownership.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Registers one isolated workflow for each guarded mutation invocation.                  │
 * │ - Keeps database and lease assertions active during service tests.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only test fixtures use this helper; production publication checks are never replaced.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema } from '@study/contracts/errors';
import { StudyError } from '@study/contracts/errors';
import { Effect, Schema, Option, Scope } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';
import type { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import type { PublicationGuard } from '#server/platform/workflows/publication';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { admitTestExecution } from '#testing/workflow-admission';

export function withTestPublication(
  context: ServerContext,
  action: Effect.Effect<void, StudyError, Database | PublicationGuard>
) {
  const execute = Effect.gen(function* () {
    const id = crypto.randomUUID();
    const workflow = Workflow.make('service-test-publication', {
      payload: { id: Schema.String },
      error: failureSchema,
      idempotencyKey: ({ id }) => id
    });
    const engine = yield* WorkflowEngine.WorkflowEngine;

    yield* engine.register(workflow, () =>
      Activity.make({
        name: 'publish',
        error: failureSchema,
        execute: withPublicationGuard(context, action)
      })
    );

    admitTestExecution(context, workflow, id, { id });
    yield* engine.execute(workflow, { executionId: id, payload: { id } });
  });

  return Effect.serviceOption(WorkflowEngine.WorkflowEngine).pipe(
    Effect.flatMap((engine) => {
      if (Option.isNone(engine))
        return execute.pipe(Effect.provide(workflowEngineLayer(context)), Effect.scoped);

      return Effect.serviceOption(Scope.Scope).pipe(
        Effect.flatMap((scope) => {
          if (Option.isNone(scope))
            return Effect.fail(
              new StudyError('internal', 'Test publication requires the runtime registration scope')
            );

          return execute.pipe(
            Effect.provideService(WorkflowEngine.WorkflowEngine, engine.value),
            Effect.provideService(Scope.Scope, scope.value)
          );
        })
      );
    })
  );
}
