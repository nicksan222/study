/** @file Owns correction within this feature. */

import {
  StudyError,
  contentSnapshotIdSchema,
  correctBlockText,
  documentSchema,
  failureSchema,
  sourceCorrectionRequestedSchema
} from '@study/contracts';
import { defineActivity, defineWorkflow, defineWorkflowHandler } from '@study/server';
import { Effect, Schema } from 'effect';

import { Sources } from '#server/features/sources/service/index';

import { noticeSourceFailure, publishSource } from './internal/publication.ts';

export const sourceCorrectionWorkflow = defineWorkflow({
  name: 'source-correction',
  version: 1,
  payload: Schema.Struct({ event: sourceCorrectionRequestedSchema }),
  success: contentSnapshotIdSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const sourceCorrectionHandler = ({
  event
}: typeof sourceCorrectionWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const sources = yield* Sources;
    const document = yield* defineActivity({
      name: 'correct-source',
      success: documentSchema,

      execute: function* () {
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
          meta: {
            ...current.document.meta,
            corrected: true,
            omissions: [
              ...new Set([
                ...current.document.meta.omissions,
                'formatting' as const,
                'structure' as const
              ])
            ]
          },
          blocks: current.document.blocks.map((item, ordinal) =>
            ordinal === event.ordinal ? correctBlockText(item, event.after) : item
          )
        };
      }
    });

    return yield* publishSource(event, document);
  }).pipe(noticeSourceFailure(event));

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
