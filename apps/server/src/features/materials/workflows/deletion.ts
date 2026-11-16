/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs retryable Material cleanup using native cancellation and guarded Activity.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retains durable ownership and content-free retirement state.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy uses public participants; native Workflow owns execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema } from '@study/contracts';
import { materialDeletionRequestedSchema } from '@study/contracts';
import { materialDeletionSchema } from '@study/contracts';
import { Database, defineWorkflow, defineWorkflowHandler, cleanupActivity } from '@study/server';
import { Effect, Schema } from 'effect';

import { Materials } from '#server/features/materials/index';

export const materialDeletionWorkflow = defineWorkflow({
  name: 'material-deletion',
  version: 1,
  payload: Schema.Struct({ event: materialDeletionRequestedSchema }),
  success: materialDeletionSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const materialDeletionHandler = Effect.fnUntraced(function* ({
  event
}: typeof materialDeletionWorkflow.payloadSchema.Type) {
  const materials = yield* Materials;
  const { store } = yield* Database;
  const previous = yield* materials.deletion({ materialId: event.materialId });

  if (previous.status === 'completed' || previous.attempt !== event.attempt) return previous;

  return yield* cleanupActivity(store, {
    name: 'retire-material-content',
    success: materialDeletionSchema,
    executions: materials.materialDeletionExecutions(event.materialId),
    publish: materials.finishMaterialDeletion({
      materialId: event.materialId,
      attempt: event.attempt
    }),
    settle: (errorKind) =>
      materials.failMaterialDeletion({
        materialId: event.materialId,
        errorKind,
        attempt: event.attempt
      }),
    failureMessage: 'Material cleanup failed'
  });
});

export const materialDeletionRegistration = defineWorkflowHandler(materialDeletionWorkflow, {
  execute: materialDeletionHandler,
  triggers: [{ subscription: 'material-deletion', event: 'MaterialDeletionRequested', emits: [] }]
});
