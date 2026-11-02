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

import { failureSchema } from '@study/contracts/errors';
import { materialHistoryPruneRequestedSchema } from '@study/contracts/events';
import { historyPruneSchema } from '@study/contracts/materials/history';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { Materials } from '#server/features/materials/index';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { WorkflowControl } from '#server/platform/workflows/control';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity, settleWorkflowFailure } from '#server/platform/workflows/retry';

export const materialHistoryWorkflow = defineWorkflow({
  name: 'material-history-prune',
  version: 1,
  payload: Schema.Struct({ event: materialHistoryPruneRequestedSchema }),
  success: historyPruneSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const materialHistoryHandler = ({
  event
}: typeof materialHistoryWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const materials = yield* Materials;
    const control = yield* WorkflowControl;
    const { store } = yield* Database;
    const previous = yield* materials.historyPrune({ operationId: event.operationId });

    if (previous.status === 'completed' || previous.attempt !== event.attempt) return previous;

    return yield* retryResumableActivity(
      Activity.make({
        name: 'prune-material-history',
        success: historyPruneSchema,
        error: failureSchema,
        execute: Effect.gen(function* () {
          const ids = yield* materials.materialHistoryExecutions(event.operationId);

          for (const id of ids)
            yield* control.cancel({
              id: Schema.decodeUnknownSync(executionIdSchema)(id),
              mode: 'unsafe'
            });

          return yield* withPublicationGuard(
            store,
            materials.finishMaterialHistory({
              operationId: event.operationId,
              attempt: event.attempt
            })
          );
        })
      })
    ).pipe(
      Effect.catchCause((cause) =>
        settleWorkflowFailure(cause, 'Material cleanup failed', (kind) =>
          materials.failMaterialHistory({
            operationId: event.operationId,
            errorKind: kind,
            attempt: event.attempt
          })
        )
      )
    );
  });

export const materialHistoryRegistration = defineWorkflowHandler(materialHistoryWorkflow, {
  execute: materialHistoryHandler,
  triggers: [
    { subscription: 'material-history-prune', event: 'MaterialHistoryPruneRequested', emits: [] }
  ]
});
