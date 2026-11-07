/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Registers durable conversation workflows and handlers for processing conversation  │
 * │ events.                                                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Connects conversation events to durable handlers and publication activities.           │
 * │ - Uses checkpoints and publication guards around durable state changes.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Effect Workflow owns durable execution; the conversations service owns domain writes     │
 * │ performed by guarded activities.                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  assistantMemorySchema,
  assistantContextBudget
} from '@study/contracts/conversations/assistant';
import { selectionReferenceKey } from '@study/contracts/conversations/context';
import type {
  selectionReferenceSchema,
  selectionRangeSchema
} from '@study/contracts/conversations/context';
import { runPreferencesSchema } from '@study/contracts/conversations/context';
import {
  ConversationMode,
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
import type { ContentSnapshotId, SourceId } from '@study/contracts/ids';
import { Clock, Effect, Option, Result, Schema } from 'effect';
import type { Context } from 'effect';
import { Activity, DurableDeferred } from 'effect/workflow';

import { assistantAgent } from '#server/features/conversations/agents/assistant';
import { compactAssistantAgent } from '#server/features/conversations/agents/assistant-compaction';
import { replyAgent } from '#server/features/conversations/agents/reply';
import { rewriteAgent } from '#server/features/conversations/agents/rewrite';
import { Conversations } from '#server/features/conversations/service/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { Agents, generateAgent } from '#server/platform/ai/agents';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';
import { Database } from '#server/platform/database/database';
import type { AgentEnvironment } from '#server/platform/definitions/define-agent';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { impactToken } from '#server/platform/definitions/impact-token';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';

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
    const database = yield* Database;
    const { store } = database;

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
    const preferences = yield* Activity.make({
      name: 'resolve-reply-preferences',
      success: runPreferencesSchema,
      error: failureSchema,
      execute: Effect.gen(function* () {
        const snapshot = yield* conversations.replySnapshot({ requestId: event.requestId });
        const settings = yield* Settings;
        const defaults = yield* settings.workspacePreferences();

        return {
          ...snapshot.context?.preferences,
          detail: snapshot.context?.preferences.detail ?? defaults.defaultAiDetail
        };
      }).pipe(Effect.provide(Settings.layer))
    });
    const memory = yield* prepareAssistantContext(event.requestId);
    const publication = yield* retryResumableActivity(
      Activity.make({
        name: 'generate-reply',
        success: publishReplyInputSchema,
        error: failureSchema,
        execute: Effect.gen(function* () {
          const snapshot = yield* conversations.replySnapshot({ requestId: event.requestId });

          yield* validateReplyEvent(snapshot, event);

          if (snapshot.context)
            yield* conversations.sessionContext({ requestId: snapshot.requestId });

          const catalog = selectionCatalog(snapshot);
          const seen = new Set<string>();

          for (const attachment of snapshot.messages.flatMap((message) => message.attachments)) {
            const key = `${attachment.sourceId}:${attachment.revision}:${attachment.snapshotId}`;

            if (seen.has(key)) continue;

            seen.add(key);
            const { document } = yield* sources
              .extraction({
                sourceId: attachment.sourceId,
                revision: attachment.revision,
                snapshotId: attachment.snapshotId
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
              reference: {
                input: {
                  kind: 'source',
                  sourceId: attachment.sourceId,
                  revision: attachment.revision,
                  snapshotId: attachment.snapshotId
                },
                sourceId: attachment.sourceId,
                documentId: attachment.snapshotId
              },
              blocks: document.blocks
            });
          }

          yield* conversations.replySnapshot({ requestId: event.requestId });
          const mode = yield* conversations.sessionMode(snapshot.sessionId);
          const options = {
            maxRetries: 0,
            maxSteps: mode === ConversationMode.Assistant ? 12 : 5,
            preflight: conversations
              .replySnapshot({ requestId: event.requestId })
              .pipe(
                Effect.andThen(
                  snapshot.context
                    ? conversations.sessionContext({ requestId: event.requestId })
                    : Effect.void
                ),
                Effect.asVoid,
                Effect.provideService(Database, database)
              )
          };
          const agentServices = {
            ...agents,
            language: preferences.language ?? agents.language,
            searchSources: (query: string) => Effect.sync(() => catalog.search(query)),
            runTool: toolRunnerForReply(mode, conversations, database, snapshot, agents.runTool)
          };
          const text = yield* (
            isRewrite(mode, snapshot)
              ? generateAgent(
                  rewriteAgent,
                  {
                    messages: snapshot.messages.map((message) => ({
                      role: message.role,
                      content: message.text
                    })),
                    origin: snapshot.generation.origin,
                    instruction: snapshot.generation.instruction,
                    preferences
                  },
                  options
                )
              : generateAgent(
                  replyAgentForMode(mode),
                  {
                    messages: replyMessages(mode, snapshot, preferences, memory)
                  },
                  options
                )
          ).pipe(Effect.provideService(Agents, agentServices), Effect.provide(Settings.layer));
          const citations =
            mode === ConversationMode.Assistant
              ? []
              : yield* Effect.try({
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

export const conversationReplyRegistration = defineWorkflowHandler(conversationReplyWorkflow, {
  execute: conversationReplyHandler,
  triggers: [
    {
      subscription: 'conversation-reply',
      event: 'ConversationGenerationRequested',
      emits: []
    }
  ]
});

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

      function* wakeReply(row: (typeof page)[number]) {
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

      for (const row of page) yield* Effect.gen(() => wakeReply(row));

      if (page.length < 100) break;

      after = page.at(-1)!.requestId;
    }
  });

export const conversationAttachmentWakeRegistration = defineWorkflowHandler(
  conversationAttachmentWakeWorkflow,
  {
    execute: conversationAttachmentWakeHandler,
    triggers: (
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
      emits: []
    }))
  }
);

function selectionCatalog(snapshot: typeof replySnapshotSchema.Type) {
  const catalog = createEvidenceCatalog<{
    sourceId: SourceId | null;
    input: typeof selectionReferenceSchema.Type;
    selectedRange?: typeof selectionRangeSchema.Type;
    documentId: ContentSnapshotId;
  }>([]);

  for (const input of snapshot.context?.inputs ?? [])
    for (const [index, excerpt] of input.excerpts.entries())
      catalog.addDocument({
        key: `selection:${selectionReferenceKey(input.input)}:${index}`,
        name: input.name,
        quoteLimit: 100000,
        reference: {
          sourceId: input.input.kind === 'source' ? input.input.sourceId : null,
          input: input.input,
          selectedRange: {
            blockId: excerpt.blockId,
            start: excerpt.start,
            end: excerpt.end
          },
          documentId: input.snapshotId
        },
        blocks: [{ text: excerpt.text, blockOrdinal: excerpt.blockOrdinal }]
      });

  return catalog;
}

function validateReplyEvent(
  snapshot: typeof replySnapshotSchema.Type,
  event: typeof conversationGenerationRequestedSchema.Type
) {
  if (
    (snapshot.pendingAttachments?.length ?? 0) > 0 ||
    snapshot.requestId !== event.requestId ||
    snapshot.sessionId !== event.sessionId ||
    snapshot.messageId !== event.messageId ||
    snapshot.versionId !== event.versionId ||
    replyOperation(snapshot) !== event.operation
  )
    return Effect.fail(new StudyError('invalid_input', 'Reply event identity mismatch'));

  return Effect.void;
}

function replyOperation(snapshot: typeof replySnapshotSchema.Type) {
  return snapshot.generation?.origin === undefined || snapshot.generation.origin === 'answer'
    ? 'reply'
    : 'rewrite';
}

function isRewrite(
  mode: ConversationMode,
  snapshot: typeof replySnapshotSchema.Type
): snapshot is typeof replySnapshotSchema.Type & {
  generation: NonNullable<(typeof replySnapshotSchema.Type)['generation']> & {
    origin: 'improve' | 'summarize' | 'instruction';
  };
} {
  return (
    mode !== ConversationMode.Assistant &&
    snapshot.generation !== undefined &&
    snapshot.generation.origin !== 'answer'
  );
}

function replyAgentForMode(mode: ConversationMode) {
  return mode === ConversationMode.Assistant ? assistantAgent : replyAgent;
}

function replyMessages(
  mode: ConversationMode,
  snapshot: typeof replySnapshotSchema.Type,
  preferences: typeof runPreferencesSchema.Type,
  memory: typeof assistantMemorySchema.Type | null
) {
  const messages = snapshot.messages
    .filter(
      (message) =>
        mode !== ConversationMode.Assistant ||
        !memory ||
        message.messageId > memory.throughMessageId
    )
    .map((message) => ({
      role: message.role,
      content: message.text
    }));

  if (mode === ConversationMode.Assistant && memory)
    return [
      {
        role: 'assistant' as const,
        content: 'Summary of earlier conversation (context, not a new request):\n' + memory.summary
      },
      ...messages
    ];

  if (mode === ConversationMode.Assistant || !snapshot.context) return messages;

  return messages.concat([
    {
      role: 'user',
      content: snapshot.context.instruction + '\nPreferences: ' + JSON.stringify(preferences)
    }
  ]);
}

/** The checkpoint retains memory across provider retries without changing visible history. */
function prepareAssistantContext(requestId: string) {
  return retryResumableActivity(
    Activity.make({
      name: 'prepare-assistant-context',
      success: Schema.NullOr(assistantMemorySchema),
      error: failureSchema,
      execute: Effect.gen(function* () {
        const conversations = yield* Conversations;
        const snapshot = yield* conversations.replySnapshot({ requestId });

        if ((yield* conversations.sessionMode(snapshot.sessionId)) !== ConversationMode.Assistant)
          return null;

        const throughMessageId = snapshot.messages.at(-1)?.messageId;

        if (throughMessageId === undefined) return null;

        const latestMemory = yield* conversations.assistantMemory(snapshot.sessionId);

        if (memoryAfterQuestion(latestMemory, throughMessageId)) return null;

        const database = yield* Database;
        let plan = yield* conversations.assistantCompactionPlan({
          sessionId: snapshot.sessionId,
          throughMessageId
        });

        if (!needsCompaction(plan)) return plan.memory;

        while (plan.characters > assistantContextBudget.keepRecent && plan.messages.length) {
          const boundary = plan.messages.at(-1)!;
          const summary = yield* generateAgent(
            compactAssistantAgent,
            {
              previous: plan.memory?.summary ?? '',
              messages: plan.messages.map(({ role, text }) => ({ role, text }))
            },
            {
              maxRetries: 0,
              preflight: conversations
                .replySnapshot({ requestId })
                .pipe(Effect.asVoid, Effect.provideService(Database, database))
            }
          );
          const now = yield* Clock.currentTimeMillis;

          yield* withPublicationGuard(
            database.store,
            conversations.saveAssistantMemory({
              sessionId: snapshot.sessionId,
              throughMessageId: boundary.messageId,
              summary,
              updatedAtMs: BigInt(now)
            })
          );
          plan = yield* conversations.assistantCompactionPlan({
            sessionId: snapshot.sessionId,
            throughMessageId
          });
        }

        return plan.memory;
      })
    })
  );
}

/** Reanswers share receipts with the immutable user question, preventing repeated side effects. */
function durableAssistantTool(
  conversations: Context.Service.Shape<typeof Conversations>,
  database: Database['Service'],
  versionId: typeof versionIdSchema.Type | undefined
): NonNullable<AgentEnvironment['runTool']> {
  return (call, execute) =>
    Effect.gen(function* () {
      if (versionId === undefined) return yield* execute;

      const key = { versionId, name: call.name, ordinal: call.ordinal };
      const intent = yield* withPublicationGuard(
        database.store,
        conversations.retainAssistantTool({ ...key, input: call.input })
      );

      if (impactToken(sortedJson(intent.input)) !== impactToken(sortedJson(call.input)))
        return yield* Effect.fail(
          new StudyError(
            'invalid_input',
            'This tool intent changed during retry. Inspect the previous result before requesting a new action.'
          )
        );

      if (Option.isSome(intent.result)) return intent.result.value;

      const result = yield* withPublicationGuard(database.store, execute);

      return yield* withPublicationGuard(
        database.store,
        conversations.completeAssistantTool({ ...key, result })
      );
    }).pipe(Effect.provideService(Database, database));
}

function sortedJson(value: Schema.Json): Schema.Json {
  if (Array.isArray(value)) return value.map(sortedJson);

  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortedJson(item)])
    );

  return value;
}

function memoryAfterQuestion(
  memory: typeof assistantMemorySchema.Type | null,
  throughMessageId: typeof assistantMemorySchema.Type.throughMessageId
) {
  return memory !== null && memory.throughMessageId >= throughMessageId;
}

function needsCompaction(plan: {
  characters: number;
  memory: typeof assistantMemorySchema.Type | null;
}) {
  return plan.characters + (plan.memory?.summary.length ?? 0) >= assistantContextBudget.compactAt;
}

function toolRunnerForReply(
  mode: ConversationMode,
  conversations: Context.Service.Shape<typeof Conversations>,
  database: Database['Service'],
  snapshot: typeof replySnapshotSchema.Type,
  fallback: AgentEnvironment['runTool']
) {
  return mode === ConversationMode.Assistant
    ? durableAssistantTool(conversations, database, snapshot.messages.at(-1)?.versionId)
    : fallback;
}
