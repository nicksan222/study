import { failureSchema, StudyError } from '@study/contracts/errors';
import { sourceProcessingRequestedSchema } from '@study/contracts/events';
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
import { fetchPage } from '#server/platform/http/index';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';
import type { Trigger } from '#server/platform/workflows/triggers';

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
    const { store } = yield* Database;
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
          const detected = fetched ? sniff(fetched.name, fetched.bytes) : null;
          const declared = fetched ? detectedMime(fetched.mime) : null;
          const input =
            fetched && detected && declared
              ? {
                  ...snapshot,
                  bytes: fetched.bytes,
                  uri: fetched.url,
                  ...(detected.kind !== 'other' &&
                  (detected.kind !== 'text' || declared.kind === 'other')
                    ? detected
                    : declared),
                  ...(fetched.mime === 'text/html' &&
                  (detected.kind === 'text' ||
                    detected.kind === 'code' ||
                    detected.kind === 'other')
                    ? { kind: 'web' as const, mime: 'text/html' }
                    : {})
                }
              : snapshot;

          if (
            input.kind === 'web' ||
            (input.mime === 'text/html' &&
              (input.kind === 'text' || input.kind === 'code' || input.kind === 'note'))
          )
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

          if (
            input.kind === 'text' ||
            input.kind === 'code' ||
            input.kind === 'note' ||
            (input.kind === 'spreadsheet' && input.mime.startsWith('text/'))
          )
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

          if (
            (input.kind === 'document' &&
              input.mime ===
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
            (input.kind === 'slides' &&
              input.mime ===
                'application/vnd.openxmlformats-officedocument.presentationml.presentation')
          ) {
            const kind = input.kind;

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

          if (
            !(
              (input.kind === 'pdf' && input.mime === 'application/pdf') ||
              (input.kind === 'image' &&
                ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mime))
            )
          )
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

    return yield* Activity.make({
      name: 'publish-source',
      success: documentIdSchema,
      error: failureSchema,
      execute: withPublicationGuard(
        store,
        sources.publishSourceDocument({
          event,
          document
        })
      )
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

export const sourceIngestionHandlerLayer = sourceIngestionWorkflow.toLayer(sourceIngestionHandler);

export function sourceProcessingRequestedTrigger(enabled: () => boolean): Trigger {
  return {
    subscription: 'source-ingestion',
    event: 'SourceProcessingRequested',
    workflowVersion: 1,
    workflow: sourceIngestionWorkflow,
    emits: ['SourceIndexed', 'SourceProcessingFailed'],
    enabled
  };
}
