import type { Failure } from '@study/contracts/errors';
import { failureSchema, StudyError } from '@study/contracts/errors';
import {
  sourceProcessingRequestedSchema,
  sourceCorrectionRequestedSchema
} from '@study/contracts/events';
import { documentIdSchema } from '@study/contracts/ids';
import { documentSchema } from '@study/contracts/sources/schemas';
import { detectedMime, sniff } from '@study/contracts/sources/sniff';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { visionTranscriptionAgent } from '#server/features/sources/agents/vision-transcription';
import { checkInput, DEFAULT_MAX_BYTES } from '#server/features/sources/decoders/common';
import { decodeHtml } from '#server/features/sources/decoders/html';
import { decodeOffice } from '#server/features/sources/decoders/office';
import { decodePdf } from '#server/features/sources/decoders/pdf';
import { decodeText } from '#server/features/sources/decoders/text';
import { visionDocument } from '#server/features/sources/decoders/vision';
import { Sources } from '#server/features/sources/service/index';
import { generateAgent } from '#server/platform/ai/agents';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { fetchPage } from '#server/platform/http/index';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';

export const sourceIngestionWorkflow = defineWorkflow({
  name: 'source-ingestion',
  version: 1,
  payload: Schema.Struct({ event: sourceProcessingRequestedSchema }),
  success: documentIdSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const sourceIngestionHandler = ({
  event
}: typeof sourceIngestionWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const sources = yield* Sources;
    const currentRequest = sources
      .sourceProcessing(event.sourceId)
      .pipe(
        Effect.flatMap((state) =>
          state.revision === event.inputVersion && state.requestId === event.requestId
            ? Effect.void
            : Effect.fail(new StudyError('invalid_input', 'Source processing is stale'))
        )
      );

    yield* currentRequest;
    const snapshot = yield* sources.sourceSnapshot({
      id: event.sourceId,
      revision: event.inputVersion
    });
    const fetched =
      snapshot.kind === 'link'
        ? yield* retryResumableActivity(
            Activity.make({
              name: 'fetch-source',
              success: Schema.Struct({
                url: Schema.String,
                bytes: Schema.Uint8Array,
                mime: Schema.String,
                name: Schema.String
              }),
              error: failureSchema,
              execute: Effect.gen(function* () {
                yield* currentRequest;

                if (snapshot.uri === null)
                  return yield* Effect.fail(new StudyError('invalid_input', 'Link has no URI'));

                return yield* fetchPage(snapshot.uri, { maxBytes: DEFAULT_MAX_BYTES });
              })
            })
          )
        : null;
    const document = yield* retryResumableActivity(
      Activity.make({
        name: 'decode-source',
        success: documentSchema,
        error: failureSchema,
        execute: Effect.gen(function* () {
          yield* currentRequest;
          const input = decodingInput();

          function decodingInput() {
            if (!fetched) return snapshot;

            const detected = sniff(fetched.name, fetched.bytes);
            const declared = detectedMime(fetched.mime);

            return {
              ...snapshot,
              bytes: fetched.bytes,
              uri: fetched.url,
              ...(detected.kind !== 'other' &&
              (detected.kind !== 'text' || declared.kind === 'other')
                ? detected
                : declared),
              ...(fetched.mime === 'text/html' && ['text', 'code', 'other'].includes(detected.kind)
                ? { kind: 'web' as const, mime: 'text/html' }
                : {})
            };
          }

          function isHtml() {
            return (
              input.kind === 'web' ||
              (input.mime === 'text/html' &&
                (input.kind === 'text' || input.kind === 'code' || input.kind === 'note'))
            );
          }

          if (isHtml())
            return yield* Effect.try({
              try: () => {
                checkInput(input.bytes, DEFAULT_MAX_BYTES);

                return decodeHtml({ bytes: input.bytes, url: input.uri ?? undefined });
              },
              catch: (cause) =>
                cause instanceof StudyError
                  ? cause
                  : new StudyError('internal', 'HTML decoding failed', { cause })
            });

          function isText() {
            return (
              input.kind === 'text' ||
              input.kind === 'code' ||
              input.kind === 'note' ||
              (input.kind === 'spreadsheet' && input.mime.startsWith('text/'))
            );
          }

          if (isText())
            return yield* Effect.try({
              try: () => {
                checkInput(input.bytes, DEFAULT_MAX_BYTES);

                return decodeText(input);
              },
              catch: (cause) =>
                cause instanceof StudyError
                  ? cause
                  : new StudyError('internal', 'Text decoding failed', { cause })
            });

          function isOffice() {
            return (
              (input.kind === 'document' &&
                input.mime ===
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
              (input.kind === 'slides' &&
                input.mime ===
                  'application/vnd.openxmlformats-officedocument.presentationml.presentation')
            );
          }

          if (isOffice()) {
            const kind = input.kind as 'document' | 'slides';

            return yield* Effect.tryPromise({
              try: (signal) => {
                checkInput(input.bytes, DEFAULT_MAX_BYTES, signal);

                return decodeOffice({ bytes: input.bytes, kind }, signal);
              },
              catch: (cause) =>
                cause instanceof StudyError
                  ? cause
                  : new StudyError('internal', 'Office decoding failed', { cause })
            });
          }

          function isVision() {
            return (
              (input.kind === 'pdf' && input.mime === 'application/pdf') ||
              (input.kind === 'image' &&
                ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mime))
            );
          }

          if (!isVision())
            return yield* Effect.fail(
              new StudyError('unsupported', 'Source type cannot be processed')
            );

          const pageCount =
            input.kind === 'pdf'
              ? yield* Effect.tryPromise({
                  try: () => decodePdf(input.bytes),
                  catch: (cause) =>
                    cause instanceof StudyError
                      ? cause
                      : new StudyError('internal', 'PDF decoding failed', { cause })
                })
              : 1;

          yield* currentRequest;
          const result = yield* generateAgent(
            visionTranscriptionAgent,
            {
              prompt: `Transcribe all ${pageCount} page(s) in order.`,
              data: input.bytes,
              mediaType: input.mime
            },
            { maxRetries: 0, preflight: currentRequest }
          );

          return yield* Effect.try({
            try: () => visionDocument(result.pages, pageCount),
            catch: (cause) =>
              cause instanceof StudyError
                ? cause
                : new StudyError('internal', 'Vision decoding failed', { cause })
          });
        })
      })
    );

    return yield* publishSource(event, document);
  }).pipe(noticeSourceFailure(event));

export const sourceIngestionRegistration = defineWorkflowHandler(sourceIngestionWorkflow, {
  execute: sourceIngestionHandler,
  triggers: [
    {
      subscription: 'source-ingestion',
      event: 'SourceProcessingRequested',
      emits: ['SourceIndexed', 'SourceProcessingFailed']
    }
  ]
});

function noticeSourceFailure(
  event: typeof sourceProcessingRequestedSchema.Type | typeof sourceCorrectionRequestedSchema.Type
) {
  return Effect.catch((error: Failure) =>
    Effect.gen(function* () {
      if (!['auth', 'config', 'model_unavailable', 'cancelled'].includes(error.kind)) {
        const sources = yield* Sources;
        const { store } = yield* Database;

        yield* Activity.make({
          name: 'notice-source-failure',
          success: Schema.Void,
          error: failureSchema,
          execute: withPublicationGuard(store, sources.noticeSourceProcessingFailure(event)).pipe(
            Effect.catch((cause) => (cause.kind === 'not_found' ? Effect.void : Effect.fail(cause)))
          )
        });
      }

      return yield* Effect.fail(error);
    })
  );
}

function publishSource(
  event: typeof sourceProcessingRequestedSchema.Type | typeof sourceCorrectionRequestedSchema.Type,
  document: typeof documentSchema.Type
) {
  return Effect.gen(function* () {
    const sources = yield* Sources;
    const { store } = yield* Database;

    return yield* Activity.make({
      name: 'publish-source',
      success: documentIdSchema,
      error: failureSchema,
      execute: withPublicationGuard(store, sources.publishSourceDocument({ event, document }))
    });
  });
}

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
