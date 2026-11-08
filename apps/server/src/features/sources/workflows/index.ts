/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs durable source ingestion and correction activities, selecting decoders from   │
 * │ canonical sniff results and publishing typed outcomes.                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature workflows own durable execution and scoped activity behavior.                  │
 * │ - Coordinates workflow activities and publication outcomes.                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses feature services for state changes and platform workflow primitives for execution.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { Failure } from '@study/contracts/errors';
import { failureSchema, StudyError } from '@study/contracts/errors';
import {
  sourceProcessingRequestedSchema,
  sourceCorrectionRequestedSchema
} from '@study/contracts/events';
import { contentSnapshotIdSchema } from '@study/contracts/ids';
import { conversionStrategyIdSchema } from '@study/contracts/sources/conversion';
import { correctBlockText } from '@study/contracts/sources/document';
import { documentSchema } from '@study/contracts/sources/schemas';
import { detectedMime, sniff } from '@study/contracts/sources/sniff';
import { Effect, Schema } from 'effect';

import { Settings } from '#server/features/settings/index';
import { visionTranscriptionAgent } from '#server/features/sources/agents/vision-transcription';
import { decoderPath } from '#server/features/sources/decoders/capability';
import { checkInput, DEFAULT_MAX_BYTES } from '#server/features/sources/decoders/common';
import { decodeHtml } from '#server/features/sources/decoders/html';
import { decodeOffice } from '#server/features/sources/decoders/office';
import { decodeText } from '#server/features/sources/decoders/text';
import { visionDocument } from '#server/features/sources/decoders/vision';
import { Sources } from '#server/features/sources/service/index';
import { generateAgent } from '#server/platform/ai/agents';
import { Database } from '#server/platform/database/database';
import {
  defineActivity,
  publicationActivity,
  resumableActivity
} from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { fetchPage } from '#server/platform/http/index';

export const sourceIngestionWorkflow = defineWorkflow({
  name: 'source-ingestion',
  version: 1,
  payload: Schema.Struct({ event: sourceProcessingRequestedSchema }),
  success: contentSnapshotIdSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

/** Decodes one retained source capture and checkpoints its guarded publication. */
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
        ? yield* resumableActivity({
            name: 'fetch-source',
            success: Schema.Struct({
              url: Schema.String,
              bytes: Schema.Uint8Array,
              mime: Schema.String,
              name: Schema.String
            }),

            execute: function* () {
              yield* currentRequest;

              if (snapshot.uri === null)
                return yield* Effect.fail(new StudyError('invalid_input', 'Link has no URI'));

              return yield* fetchPage(snapshot.uri, { maxBytes: DEFAULT_MAX_BYTES });
            }
          })
        : null;

    /** Reconciles fetched MIME and sniffed content before choosing a decoder or PDF strategy. */
    function decodingInput() {
      if (!fetched) return snapshot;

      const detected = sniff(fetched.name, fetched.bytes);
      const declared = detectedMime(fetched.mime);

      return {
        ...snapshot,
        bytes: fetched.bytes,
        uri: fetched.url,
        ...(detected.kind !== 'other' && (detected.kind !== 'text' || declared.kind === 'other')
          ? detected
          : declared),
        ...(fetched.mime === 'text/html' && ['text', 'code', 'other'].includes(detected.kind)
          ? { kind: 'web' as const, mime: 'text/html' }
          : {})
      };
    }

    const input = decodingInput();
    const conversionStrategyId =
      input.kind === 'pdf'
        ? yield* defineActivity({
            name: 'resolve-source-conversion-strategy',
            success: conversionStrategyIdSchema,

            execute: Effect.flatMap(Settings, (settings) => settings.workspacePreferences()).pipe(
              Effect.flatMap((preferences) =>
                Effect.try({
                  try: () =>
                    Sources.conversionStrategyForInput(preferences.textConversionStrategy, 'pdf')
                      .id,
                  catch: (cause) =>
                    cause instanceof StudyError
                      ? cause
                      : new StudyError('internal', 'Invalid conversion strategy', { cause })
                })
              ),
              Effect.provide(Settings.layer)
            )
          })
        : null;
    const document = yield* resumableActivity({
      name: 'decode-source',
      success: documentSchema,

      execute: function* () {
        yield* currentRequest;

        function isHtml() {
          return decoderPath(input) === 'html';
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
          return decoderPath(input) === 'text';
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
          return decoderPath(input) === 'office';
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
          return decoderPath(input) === 'vision';
        }

        if (!isVision())
          return yield* Effect.fail(
            new StudyError('unsupported', 'Source type cannot be processed')
          );

        if (input.kind === 'pdf') {
          if (conversionStrategyId === null)
            return yield* Effect.fail(
              new StudyError('config', 'PDF conversion strategy is unavailable')
            );

          return yield* sources.convertDocument(
            conversionStrategyId,
            { kind: 'pdf', bytes: input.bytes },
            {
              generate: (definition, data) =>
                generateAgent(definition, data, { maxRetries: 0, preflight: currentRequest })
            }
          );
        }

        const pageCount = 1;

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
      }
    });

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

        yield* publicationActivity(store, {
          name: 'notice-source-failure',
          success: Schema.Void,

          execute: sources
            .noticeSourceProcessingFailure(event)
            .pipe(
              Effect.catch((cause) =>
                cause.kind === 'not_found' ? Effect.void : Effect.fail(cause)
              )
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

    return yield* publicationActivity(store, {
      name: 'publish-source',
      success: contentSnapshotIdSchema,

      execute: sources.publishSourceDocument({ event, document })
    });
  });
}

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
