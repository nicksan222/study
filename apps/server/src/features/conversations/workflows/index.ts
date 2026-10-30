import {
  publishReplyInputSchema,
  replySnapshotSchema
} from '@study/contracts/conversations/schemas';
import { failureSchema, StudyError } from '@study/contracts/errors';
import {
  conversationGenerationRequestedSchema,
  sourceIndexedSchema,
  sourceDeletedSchema,
  sourceProjectChangedSchema,
  sourceProcessingFailedSchema,
  sourceProcessingRequestedSchema,
  sourceCorrectionRequestedSchema
} from '@study/contracts/events';
import { versionIdSchema } from '@study/contracts/ids';
import type { DocumentId, SourceId } from '@study/contracts/ids';
import { Effect, Result, Schema } from 'effect';
import { Activity, DurableDeferred } from 'effect/workflow';

import { replyAgent } from '#server/features/conversations/agents/reply';
import { rewriteAgent } from '#server/features/conversations/agents/rewrite';
import { Conversations } from '#server/features/conversations/service/index';
import { Sources } from '#server/features/sources/index';
import { Agents, generateAgent } from '#server/platform/ai/agents';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';
import type { Trigger } from '#server/platform/workflows/triggers';

export const conversationReplyWorkflow = defineWorkflow({
  name: 'conversation-reply',
  version: 1,
  payload: Schema.Struct({ event: conversationGenerationRequestedSchema }),
  success: versionIdSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

const attachmentGate = (sourceId: SourceId, requestId: string) =>
  DurableDeferred.make(`attachment/${sourceId}/${requestId}`, { error: failureSchema });

export const conversationReplyHandler = ({
  event
}: typeof conversationReplyWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const sources = yield* Sources;
    const agents = yield* Agents;
    const { store } = yield* Database;

    const pending = yield* conversations.replyReadiness({ requestId: event.requestId });

    for (const part of pending) {
      const stillPending = yield* conversations.replyReadiness({ requestId: event.requestId });

      if (
        stillPending.some(
          (item) => item.sourceId === part.sourceId && item.requestId === part.requestId
        )
      )
        yield* DurableDeferred.await(attachmentGate(part.sourceId, part.requestId));
    }

    yield* Activity.make({
      name: 'seal-reply-attachments',
      success: replySnapshotSchema,
      error: failureSchema,
      execute: withPublicationGuard(
        store,
        conversations.sealReplyAttachments({ requestId: event.requestId })
      )
    });
    const publication = yield* retryResumableActivity(
      Activity.make({
        name: 'generate-reply',
        success: publishReplyInputSchema,
        error: failureSchema,
        execute: Effect.gen(function* () {
          const snapshot = yield* conversations.replySnapshot({ requestId: event.requestId });

          if (
            (snapshot.pendingAttachments?.length ?? 0) > 0 ||
            snapshot.requestId !== event.requestId ||
            snapshot.sessionId !== event.sessionId ||
            snapshot.messageId !== event.messageId ||
            snapshot.versionId !== event.versionId ||
            (snapshot.generation?.origin === undefined || snapshot.generation.origin === 'answer'
              ? 'reply'
              : 'rewrite') !== event.operation
          )
            return yield* Effect.fail(
              new StudyError('invalid_input', 'Reply event identity mismatch')
            );

          const catalog = createEvidenceCatalog<{
            sourceId: SourceId;
            documentId: DocumentId;
          }>([]);
          const seen = new Set<string>();

          for (const attachment of snapshot.messages.flatMap((message) => message.attachments)) {
            const key = `${attachment.sourceId}:${attachment.documentId}`;

            if (seen.has(key)) continue;

            seen.add(key);
            const { document } = yield* sources
              .document({
                id: attachment.documentId,
                sourceId: attachment.sourceId,
                projectId: attachment.projectId
              })
              .pipe(
                Effect.mapError((error) =>
                  error.kind === 'not_found'
                    ? new StudyError('invalid_input', 'Captured attachment is unavailable', {
                        cause: error
                      })
                    : error
                )
              );

            catalog.addDocument({
              key,
              name: attachment.sourceName,
              reference: { sourceId: attachment.sourceId, documentId: attachment.documentId },
              blocks: document.blocks
            });
          }

          yield* conversations.replySnapshot({ requestId: event.requestId });
          const options = {
            maxRetries: 0,
            preflight: conversations
              .replySnapshot({ requestId: event.requestId })
              .pipe(Effect.asVoid)
          };
          const agentServices = {
            ...agents,
            searchSources: (query: string) => Effect.sync(() => catalog.search(query))
          };
          const text = yield* (
            snapshot.generation && snapshot.generation.origin !== 'answer'
              ? generateAgent(
                  rewriteAgent,
                  {
                    messages: snapshot.messages.map((message) => ({
                      role: message.role,
                      content: message.text
                    })),
                    origin: snapshot.generation.origin,
                    instruction: snapshot.generation.instruction
                  },
                  options
                )
              : generateAgent(
                  replyAgent,
                  {
                    messages: snapshot.messages.map((message) => ({
                      role: message.role,
                      content: message.text
                    }))
                  },
                  options
                )
          ).pipe(Effect.provideService(Agents, agentServices));
          const citations = yield* Effect.try({
            try: () =>
              catalog
                .citations(text)
                .map(({ reference, ...citation }) => ({ ...citation, ...reference })),
            catch: (error) =>
              error instanceof StudyError
                ? error
                : new StudyError('invalid_input', 'Invalid citations', { cause: error })
          });

          return { requestId: event.requestId, text, citations };
        })
      })
    );

    return yield* Activity.make({
      name: 'publish-reply',
      success: versionIdSchema,
      error: failureSchema,
      execute: withPublicationGuard(store, conversations.publishReply(publication))
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        if (['invalid_input', 'not_found', 'unsupported'].includes(error.kind)) {
          const conversations = yield* Conversations;
          const { store } = yield* Database;

          yield* Activity.make({
            name: 'retire-invalid-reply',
            success: Schema.Void,
            error: failureSchema,
            execute: withPublicationGuard(
              store,
              conversations.abandonReply({
                requestId: event.requestId,
                sessionId: event.sessionId,
                messageId: event.messageId,
                versionId: event.versionId
              })
            ).pipe(Effect.asVoid)
          });
        }

        return yield* Effect.fail(error);
      })
    )
  );

export const conversationReplyHandlerLayer =
  conversationReplyWorkflow.toLayer(conversationReplyHandler);

export function conversationGenerationRequestedTrigger(enabled: () => boolean): Trigger {
  return {
    subscription: 'conversation-reply',
    event: 'ConversationGenerationRequested',
    workflowVersion: 1,
    workflow: conversationReplyWorkflow,
    emits: [],
    enabled
  };
}

const sourceWakeEventSchema = Schema.Union([
  sourceIndexedSchema,
  sourceDeletedSchema,
  sourceProjectChangedSchema,
  sourceProcessingFailedSchema,
  sourceProcessingRequestedSchema,
  sourceCorrectionRequestedSchema
]);

export const conversationAttachmentWakeWorkflow = defineWorkflow({
  name: 'conversation-attachment-wake',
  version: 1,
  payload: Schema.Struct({ event: sourceWakeEventSchema }),
  success: Schema.Void,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const conversationAttachmentWakeHandler = ({
  event
}: typeof conversationAttachmentWakeWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    let after: string | undefined;

    for (;;) {
      const page = yield* conversations.replyWakes({ sourceId: event.sourceId, after, limit: 100 });

      for (const row of page) {
        const readiness = yield* Effect.result(
          conversations.replyReadiness({ requestId: row.requestId })
        );

        if (Result.isFailure(readiness)) {
          if (!['invalid_input', 'not_found', 'unsupported'].includes(readiness.failure.kind))
            return yield* Effect.fail(readiness.failure);

          for (const part of row.pendingAttachments) {
            const gate = attachmentGate(part.sourceId, part.requestId);

            yield* DurableDeferred.fail(gate, {
              token: DurableDeferred.tokenFromExecutionId(gate, {
                workflow: conversationReplyWorkflow,
                executionId: row.executionId
              }),
              error: new StudyError('invalid_input', 'Captured attachment is unavailable')
            });
          }
        } else {
          for (const part of row.pendingAttachments) {
            if (
              readiness.success.some(
                (item) => item.sourceId === part.sourceId && item.requestId === part.requestId
              )
            )
              continue;

            const gate = attachmentGate(part.sourceId, part.requestId);

            yield* DurableDeferred.succeed(gate, {
              token: DurableDeferred.tokenFromExecutionId(gate, {
                workflow: conversationReplyWorkflow,
                executionId: row.executionId
              }),
              value: undefined
            });
          }
        }
      }

      if (page.length < 100) break;

      after = page.at(-1)!.requestId;
    }
  });

export const conversationAttachmentWakeHandlerLayer = conversationAttachmentWakeWorkflow.toLayer(
  conversationAttachmentWakeHandler
);

export function conversationAttachmentWakeTriggers(enabled: () => boolean): Trigger[] {
  return (
    [
      'SourceIndexed',
      'SourceDeleted',
      'SourceProjectChanged',
      'SourceProcessingFailed',
      'SourceProcessingRequested',
      'SourceCorrectionRequested'
    ] as const
  ).map((event) => ({
    subscription: `conversation-attachment-wake/${event.toLowerCase()}`,
    event,
    workflowVersion: 1,
    workflow: conversationAttachmentWakeWorkflow,
    emits: [],
    enabled
  }));
}
