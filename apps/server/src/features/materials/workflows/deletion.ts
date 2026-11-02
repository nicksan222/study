/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs retryable Material cleanup using native cancellation and guarded Activity.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retains durable ownership and content-free retirement state.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy uses public participants; native Workflow owns execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema, StudyError } from '@study/contracts/errors';
import { materialDeletionRequestedSchema } from '@study/contracts/events';
import { materialDeletionSchema } from '@study/contracts/materials/deletion';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { Cause, Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { Materials } from '#server/features/materials/index';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { WorkflowControl } from '#server/platform/workflows/control';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';

export const materialDeletionWorkflow = defineWorkflow({
  name: 'material-deletion',
  version: 1,
  payload: Schema.Struct({ event: materialDeletionRequestedSchema }),
  success: materialDeletionSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const materialDeletionHandler = ({
  event
}: typeof materialDeletionWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const materials = yield* Materials;
    const control = yield* WorkflowControl;
    const { store } = yield* Database;
    const previous = yield* materials.deletion({ materialId: event.materialId });

    if (previous.status === 'completed' || previous.attempt !== event.attempt) return previous;

    return yield* retryResumableActivity(
      Activity.make({
        name: 'retire-material-content',
        success: materialDeletionSchema,
        error: failureSchema,
        execute: Effect.gen(function* () {
          const ids = yield* materials.materialDeletionExecutions(event.materialId);

          for (const id of ids)
            yield* control.cancel({
              id: Schema.decodeUnknownSync(executionIdSchema)(id),
              mode: 'unsafe'
            });

          return yield* withPublicationGuard(
            store,
            materials.finishMaterialDeletion({
              materialId: event.materialId,
              attempt: event.attempt
            })
          );
        })
      })
    ).pipe(
      Effect.catchCause((cause) => {
        const failure = Cause.squash(cause);
        const kind =
          failure instanceof StudyError
            ? failure.kind
            : Cause.hasInterrupts(cause)
              ? 'cancelled'
              : 'internal';
        const error = new StudyError(kind, 'Material cleanup failed');

        return materials
          .failMaterialDeletion({
            materialId: event.materialId,
            errorKind: kind,
            attempt: event.attempt
          })
          .pipe(
            Effect.uninterruptible,
            Effect.catchCause(() => Effect.fail(error)),
            Effect.andThen(Effect.fail(error))
          );
      })
    );
  });

export const materialDeletionRegistration = defineWorkflowHandler(materialDeletionWorkflow, {
  execute: materialDeletionHandler,
  triggers: [{ subscription: 'material-deletion', event: 'MaterialDeletionRequested', emits: [] }]
});
