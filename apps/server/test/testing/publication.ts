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

import { failureSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import type { ServerContext } from '@study/server';
import type { Database } from '@study/server';
import { workflowEngineLayer } from '@study/server';
import type { PublicationGuard } from '@study/server';
import { withPublicationGuard } from '@study/server';
import { Effect, Schema, Option, Scope } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import { admitTestExecution } from '#testing/workflow-admission';

export function withTestPublication(
  context: ServerContext,
  action: Effect.Effect<void, StudyError, Database | PublicationGuard>
) {
  const execute = Effect.gen(function* () {
    const id = crypto.randomUUID();
    const workflow = Workflow.make(`service-test-publication/${id}`, {
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
