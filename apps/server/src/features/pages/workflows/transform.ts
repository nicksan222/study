/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Generates authored Page alternatives from exact captured note                      │
 * │ evidence.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Generates authored Page alternatives from exact captured note evidence.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow and Activities own durable execution; public services enforce            │
 * │ publication policy.                                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema, StudyError } from '@study/contracts/errors';
import { pageGenerationRequestedSchema } from '@study/contracts/events';
import { pageVersionIdSchema } from '@study/contracts/ids';
import { selectionReferenceKey } from '@study/contracts/notes/context';
import type { citationSchema } from '@study/contracts/pages/schemas';
import type { pageTransformContextSchema } from '@study/contracts/pages/transform';
import { transformPublicationSchema } from '@study/contracts/pages/transform';
import type { transformSnapshotSchema } from '@study/contracts/pages/transform';
import { Effect, Schema } from 'effect';

import { Notes } from '#server/features/notes/index';
import { pageTransformAgent } from '#server/features/pages/agents/page-transform';
import { validatePageTransform } from '#server/features/pages/decoders/page-transform';
import { canonicalPageTransformOutput } from '#server/features/pages/decoders/page-transform-output';
import { pageTransformPrompt } from '#server/features/pages/decoders/page-transform-prompt';
import { Pages } from '#server/features/pages/index';
import { Agents, generateAgent } from '#server/platform/ai/agents';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';
import { Database } from '#server/platform/database/database';
import { defineActivity, publicationActivity } from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { retryResumableActivity } from '#server/platform/workflows/retry';

export const pageTransformWorkflow = defineWorkflow({
  name: 'document-transform',
  version: 1,
  payload: Schema.Struct({ event: pageGenerationRequestedSchema }),
  success: pageVersionIdSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const pageTransformHandler = Effect.fnUntraced(function* ({
  event
}: typeof pageTransformWorkflow.payloadSchema.Type) {
  const docs = yield* Pages;
  const notes = yield* Notes;
  const database = yield* Database;
  const request = yield* docs.transform({ requestId: event.requestId });

  if (
    event.causationId !== null ||
    event.correlationId !== request.id ||
    event.inputVersion !== 1 ||
    event.depth !== 0
  )
    return yield* Effect.fail(
      new StudyError('invalid_input', 'Page generation event identity mismatch')
    );

  if (request.resultVersionId !== null) return request.resultVersionId;

  const preflight = Effect.gen(function* () {
    const current = yield* docs.transform({ requestId: event.requestId });

    if (current.cancelled || current.eventId !== event.eventId || current.resultVersionId !== null)
      return yield* Effect.fail(new StudyError('cancelled', 'Page generation is no longer active'));

    return yield* request.merge
      ? docs.mergeContext({ requestId: request.id })
      : notes.pageTransformContext({ requestId: request.id });
  });

  return yield* Effect.gen(function* () {
    const output = yield* retryResumableActivity(
      generateTransform(
        request,
        event.eventId,
        preflight.pipe(Effect.provideService(Database, database))
      )
    );

    return yield* publicationActivity(database.store, {
      name: 'publish-authored-document',
      success: pageVersionIdSchema,

      execute: request.merge ? docs.publishMerge(output) : notes.publishPageTransform(output)
    });
  }).pipe(
    Effect.catch((error) =>
      publicationActivity(database.store, {
        name: 'record-authored-generation-failure',

        execute: docs.failTransform({
          requestId: request.id,
          eventId: event.eventId,
          errorKind: error.kind
        })
      }).pipe(Effect.andThen(Effect.fail(error)))
    )
  );
});

export const pageTransformRegistration = defineWorkflowHandler(pageTransformWorkflow, {
  execute: pageTransformHandler,
  triggers: [
    {
      subscription: 'document-transform',
      event: 'PageGenerationRequested',
      emits: ['PagePublished', 'PageGenerationFailed']
    }
  ]
});

function generateTransform(
  request: typeof transformSnapshotSchema.Type,
  eventId: string,
  preflight: Effect.Effect<typeof pageTransformContextSchema.Type, StudyError>
) {
  return defineActivity({
    name: 'generate-authored-document',
    success: transformPublicationSchema,

    execute: function* () {
      const context = yield* preflight;
      const agents = yield* Agents;
      const catalog = createEvidenceCatalog<{
        input: typeof citationSchema.Type.input;
        target: typeof citationSchema.Type.target;
        anchor: typeof citationSchema.Type.anchor;
      }>([]);

      for (const input of context.inputs)
        for (const [index, excerpt] of input.excerpts.entries())
          catalog.addDocument({
            key: `${selectionReferenceKey(input.input)}:${index}`,
            name: input.name,
            reference: {
              input: input.input,
              target: { blockId: excerpt.blockId, start: excerpt.start, end: excerpt.end },
              anchor: excerpt.anchor
            },
            quoteLimit: 100000,
            blocks: [{ text: excerpt.text, blockOrdinal: excerpt.blockOrdinal }]
          });

      for (const message of context.messages)
        catalog.addDocument({
          key: `message:${message.versionId}`,
          name: `${message.role} ${message.messageId}`,
          reference: {
            input: { kind: 'message', versionId: message.versionId },
            target: null,
            anchor: { type: 'authored' }
          },
          quoteLimit: 100000,
          blocks: [{ text: message.text, blockOrdinal: 0 }]
        });

      const { prompt, editTarget } = yield* Effect.try({
        try: () => pageTransformPrompt(request, context),
        catch: (cause) => new StudyError('invalid_input', 'Invalid captured Page prompt', { cause })
      });
      const output = yield* generateAgent(
        pageTransformAgent,
        { prompt },
        { maxRetries: 0, preflight: preflight.pipe(Effect.asVoid) }
      ).pipe(
        Effect.provideService(Agents, {
          ...agents,
          searchSources: (query: string) => Effect.sync(() => catalog.search(query))
        })
      );

      return yield* Effect.try({
        try: () => {
          const result = canonicalPageTransformOutput(output, editTarget?.document?.blocks);
          const citations = catalog
            .citations(
              [
                ...result.document.blocks.map((block) => block.text),
                ...result.report.notes.map((note) => note.explanation)
              ].join('\n')
            )
            .map(({ marker, reference, quote }) => ({ marker, ...reference, quote }));
          const publication = {
            ...result,
            requestId: request.id,
            generationEventId: eventId,
            language: context.preferences.language,
            citations
          };

          validatePageTransform(context, publication, request.editTargetVersionId);

          return publication;
        },
        catch: (cause) =>
          cause instanceof StudyError
            ? cause
            : new StudyError('invalid_input', 'Invalid Page output', { cause })
      });
    }
  });
}
