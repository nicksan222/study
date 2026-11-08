/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Executes durable history cleanup with cancellation and guarded native Activities.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Cancels exactly retired executions before synchronous content cleanup.                 │
 * │ - Settles failures and rejects stale attempts through the Material service.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution lifetime; Materials owns transactional cleanup policy.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema } from '@study/contracts/errors';
import { materialHistoryPruneRequestedSchema } from '@study/contracts/events';
import { historyPruneSchema } from '@study/contracts/materials/history';
import { Effect, Schema } from 'effect';

import { Materials } from '#server/features/materials/index';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { cleanupActivity } from '#server/platform/workflows/cleanup';

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

    const { store } = yield* Database;

    const previous = yield* materials.historyPrune({ operationId: event.operationId });

    if (previous.status === 'completed' || previous.attempt !== event.attempt) return previous;

    return yield* cleanupActivity(store, {
      name: 'prune-material-history',
      success: historyPruneSchema,
      executions: materials.materialHistoryExecutions(event.operationId),
      publish: materials.finishMaterialHistory({
        operationId: event.operationId,
        attempt: event.attempt
      }),
      settle: (errorKind) =>
        materials.failMaterialHistory({
          operationId: event.operationId,
          errorKind,
          attempt: event.attempt
        }),
      failureMessage: 'Material cleanup failed'
    });
  });

export const materialHistoryRegistration = defineWorkflowHandler(materialHistoryWorkflow, {
  execute: materialHistoryHandler,
  triggers: [
    { subscription: 'material-history-prune', event: 'MaterialHistoryPruneRequested', emits: [] }
  ]
});
