import { failureSchema, StudyError } from '@study/contracts/errors';
import { sourceCorrectionRequestedSchema } from '@study/contracts/events';
import { documentIdSchema } from '@study/contracts/ids';
import { documentSchema } from '@study/contracts/sources/schemas';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { Sources } from '#server/features/sources/service/index';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { withPublicationGuard } from '#server/platform/workflows/publication';

export const sourceCorrectionWorkflow = defineWorkflow({
  name: 'source-correction',
  version: 1,
  payload: Schema.Struct({ event: sourceCorrectionRequestedSchema }),
  success: documentIdSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const sourceCorrectionHandler = ({
  event
}: typeof sourceCorrectionWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const sources = yield* Sources;
    const { store } = yield* Database;
    const document = yield* Activity.make({
      name: 'correct-source',
      success: documentSchema,
      error: failureSchema,
      execute: Effect.gen(function* () {
        const state = yield* sources.sourceProcessing(event.sourceId);

        if (
          state.revision !== event.inputVersion ||
          state.requestId !== event.requestId ||
          state.documentId !== event.documentId
        )
          return yield* Effect.fail(new StudyError('invalid_input', 'source correction is stale'));

        const current = yield* sources.sourceDocument(event.sourceId);
        const block = current.document.blocks[event.ordinal];

        if (!block || block.text !== event.before)
          return yield* Effect.fail(new StudyError('invalid_input', 'source block is stale'));

        return {
          ...current.document,
          meta: { ...current.document.meta, corrected: true },
          blocks: current.document.blocks.map((item, ordinal) =>
            ordinal === event.ordinal ? { ...item, text: event.after } : item
          )
        };
      })
    });

    return yield* Activity.make({
      name: 'publish-source',
      success: documentIdSchema,
      error: failureSchema,
      execute: withPublicationGuard(store, sources.publishSourceDocument({ event, document }))
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        if (!['auth', 'config', 'model_unavailable', 'cancelled'].includes(error.kind)) {
          const sources = yield* Sources;
          const { store } = yield* Database;

          yield* Activity.make({
            name: 'notice-source-failure',
            success: Schema.Void,
            error: failureSchema,
            execute: withPublicationGuard(store, sources.noticeSourceProcessingFailure(event)).pipe(
              Effect.catch((cause) =>
                cause.kind === 'not_found' ? Effect.void : Effect.fail(cause)
              )
            )
          });
        }

        return yield* Effect.fail(error);
      })
    )
  );

export const sourceCorrectionRegistration = defineWorkflowHandler(sourceCorrectionWorkflow, {
  execute: sourceCorrectionHandler,
  triggers: [
    {
      subscription: 'source-correction',
      event: 'SourceCorrectionRequested',
      emits: ['SourceIndexed', 'SourceProcessingFailed']
    }
  ]
});
