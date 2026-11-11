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
import type { StudyError } from '@study/contracts/errors';
import { Effect, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';
import type { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import type { PublicationGuard } from '#server/platform/workflows/publication';
import { withPublicationGuard } from '#server/platform/workflows/publication';

export function withTestPublication(
  context: ServerContext,
  action: Effect.Effect<void, StudyError, Database | PublicationGuard>
) {
  return Effect.scoped(
    Effect.gen(function* () {
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

      yield* engine.execute(workflow, { executionId: id, payload: { id } });
    }).pipe(Effect.provide(workflowEngineLayer(context)))
  );
}
