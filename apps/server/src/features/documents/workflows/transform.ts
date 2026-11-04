import { selectionReferenceKey } from '@study/contracts/conversations/context';
import type { runSelectionContextSchema } from '@study/contracts/conversations/context';
import type { citationSchema } from '@study/contracts/documents/schemas';
import { transformPublicationSchema } from '@study/contracts/documents/transform';
import type { transformSnapshotSchema } from '@study/contracts/documents/transform';
import { failureSchema, StudyError } from '@study/contracts/errors';
import { documentGenerationRequestedSchema } from '@study/contracts/events';
import { studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { Effect, Schema } from 'effect';
import { Activity } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { documentTransformAgent } from '#server/features/documents/agents/document-transform';
import { validateDocumentTransform } from '#server/features/documents/decoders/document-transform';
import { canonicalDocumentTransformOutput } from '#server/features/documents/decoders/document-transform-output';
import { documentTransformPrompt } from '#server/features/documents/decoders/document-transform-prompt';
import { Documents } from '#server/features/documents/index';
import { Agents, generateAgent } from '#server/platform/ai/agents';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';

export const documentTransformWorkflow = defineWorkflow({
  name: 'document-transform',
  version: 1,
  payload: Schema.Struct({ event: documentGenerationRequestedSchema }),
  success: studyDocumentVersionIdSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});
export const documentTransformHandler = ({
  event
}: typeof documentTransformWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const docs = yield* Documents;
    const conversations = yield* Conversations;
    const database = yield* Database;
    const request = yield* docs.transform({ requestId: event.requestId });
    if (
      event.causationId !== null ||
      event.correlationId !== request.id ||
      event.inputVersion !== 1 ||
      event.depth !== 0
    )
      return yield* Effect.fail(
        new StudyError('invalid_input', 'Document generation event identity mismatch')
      );
    if (request.resultVersionId !== null) return request.resultVersionId;
    const preflight = Effect.gen(function* () {
      const current = yield* docs.transform({ requestId: event.requestId });
      if (
        current.cancelled ||
        current.eventId !== event.eventId ||
        current.resultVersionId !== null
      )
        return yield* Effect.fail(
          new StudyError('cancelled', 'Document generation is no longer active')
        );
      return yield* conversations.documentTransformContext({ requestId: request.id });
    });
    return yield* Effect.gen(function* () {
      const output = yield* retryResumableActivity(
        Activity.make({
          name: 'generate-authored-document',
          success: transformPublicationSchema,
          error: failureSchema,
          execute: Effect.gen(function* () {
            const context = yield* preflight;
            return yield* generateTransform(
              request,
              context,
              event.eventId,
              preflight.pipe(Effect.asVoid, Effect.provideService(Database, database))
            );
          })
        })
      );
      return yield* Activity.make({
        name: 'publish-authored-document',
        success: studyDocumentVersionIdSchema,
        error: failureSchema,
        execute: withPublicationGuard(
          database.store,
          conversations.publishDocumentTransform(output)
        )
      });
    }).pipe(
      Effect.catch((error) =>
        Activity.make({
          name: 'record-authored-generation-failure',
          error: failureSchema,
          execute: withPublicationGuard(
            database.store,
            docs.failTransform({
              requestId: request.id,
              eventId: event.eventId,
              errorKind: error.kind
            })
          )
        }).pipe(Effect.andThen(Effect.fail(error)))
      )
    );
  });
export const documentTransformRegistration = defineWorkflowHandler(documentTransformWorkflow, {
  execute: documentTransformHandler,
  triggers: [
    {
      subscription: 'document-transform',
      event: 'DocumentGenerationRequested',
      emits: ['DocumentPublished', 'DocumentGenerationFailed']
    }
  ]
});

function generateTransform(
  request: typeof transformSnapshotSchema.Type,
  context: typeof runSelectionContextSchema.Type,
  eventId: string,
  preflight: Effect.Effect<void, StudyError>
) {
  return Effect.gen(function* () {
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
      try: () => documentTransformPrompt(request, context),
      catch: (cause) =>
        new StudyError('invalid_input', 'Invalid captured Document prompt', { cause })
    });
    const output = yield* generateAgent(
      documentTransformAgent,
      { prompt },
      { maxRetries: 0, preflight }
    ).pipe(
      Effect.provideService(Agents, {
        ...agents,
        searchSources: (query: string) => Effect.sync(() => catalog.search(query))
      })
    );
    return yield* Effect.try({
      try: () => {
        const result = canonicalDocumentTransformOutput(output, editTarget?.document?.blocks);
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
        validateDocumentTransform(context, publication, request.editTargetVersionId);
        return publication;
      },
      catch: (cause) =>
        cause instanceof StudyError
          ? cause
          : new StudyError('invalid_input', 'Invalid Document output', { cause })
    });
  });
}
