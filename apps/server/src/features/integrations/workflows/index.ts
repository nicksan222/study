/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs external imports through native checkpointed Workflow and Activity.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reserves destinations and fences each content publication.                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns recovery while the feature service owns publication policy.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema, StudyError } from '@study/contracts/errors';
import { integrationImportRequestedSchema } from '@study/contracts/events';
import { integrationImportSchema } from '@study/contracts/integrations/schemas';
import { Effect, Schema } from 'effect';

import { Integrations } from '#server/features/integrations/index';
import { Database } from '#server/platform/database/database';
import { defineActivity } from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity, settleWorkflowFailure } from '#server/platform/workflows/retry';

const integrationImportWorkflow = defineWorkflow({
  name: 'integration-import',
  version: 1,
  payload: Schema.Struct({ event: integrationImportRequestedSchema }),
  success: integrationImportSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const integrationImportRegistration = defineWorkflowHandler(integrationImportWorkflow, {
  execute: ({ event }) =>
    Effect.gen(function* () {
      const integrations = yield* Integrations;
      const { store } = yield* Database;
      const input = { id: event.importId, attempt: event.attempt };
      let key: string | undefined;
      const activity = (name: string, execute: ReturnType<typeof integrations.reserveImport>) =>
        retryResumableActivity(
          defineActivity({
            name,
            success: Schema.Boolean,

            execute: withPublicationGuard(store, execute).pipe(
              Effect.map((state) => state.status === 'running')
            )
          })
        );

      return yield* Effect.gen(function* () {
        yield* activity('reserve-destinations', integrations.reserveImport(input));
        const state = yield* integrations.import(input);

        if (state.status !== 'running') return state;

        for (const item of state.items.filter((entry) => entry.status === 'pending')) {
          key = item.key;
          const result = yield* activity(
            `publish/${item.key}`,
            integrations.publishImportItem({ ...input, key })
          );

          if (!result) return yield* integrations.import(input);

          key = undefined;
        }

        yield* activity('finish-import', integrations.settleImport({ ...input, errorKind: null }));

        return yield* integrations.import(input);
      }).pipe(
        Effect.mapError(
          (error) => new StudyError(error.kind, error.message, { retryAfterMs: error.retryAfterMs })
        ),
        Effect.catchCause((cause) =>
          settleWorkflowFailure(cause, 'Integration import failed', (errorKind) =>
            activity('settle-failure', integrations.settleImport({ ...input, errorKind, key }))
          )
        )
      );
    }),
  triggers: [
    {
      subscription: 'integration-import',
      event: 'IntegrationImportRequested',
      emits: ['SourceProcessingRequested', 'PagePublished']
    }
  ]
});
