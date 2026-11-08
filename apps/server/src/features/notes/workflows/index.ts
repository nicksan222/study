/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Registers durable note workflows and handlers for processing note                  │
 * │ events.                                                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Connects note events to durable handlers and publication activities.                   │
 * │ - Uses checkpoints and publication guards around durable state changes.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Effect Workflow owns durable execution; the notes service owns domain writes             │
 * │ performed by guarded activities.                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema, StudyError } from '@study/contracts/errors';
import {
  noteGenerationRequestedSchema,
  sourceIndexedSchema,
  sourceDeletedSchema,
  sourceProjectChangedSchema,
  sourceProcessingFailedSchema,
  sourceProcessingRequestedSchema,
  sourceCorrectionRequestedSchema
} from '@study/contracts/events';
import { versionIdSchema } from '@study/contracts/ids';
import type { ContentSnapshotId, SourceId } from '@study/contracts/ids';
import { assistantMemorySchema, assistantContextBudget } from '@study/contracts/notes/assistant';
import { selectionReferenceKey } from '@study/contracts/notes/context';
import type {
  selectionReferenceSchema,
  selectionRangeSchema
} from '@study/contracts/notes/context';
import { runPreferencesSchema } from '@study/contracts/notes/context';
import {
  NoteMode,
  publishReplyInputSchema,
  replySnapshotSchema
} from '@study/contracts/notes/schemas';
import { Clock, Effect, Option, Result, Schema } from 'effect';
import type { Context } from 'effect';
import { DurableDeferred } from 'effect/workflow';

import { assistantAgent } from '#server/features/notes/agents/assistant';
import { compactAssistantAgent } from '#server/features/notes/agents/assistant-compaction';
import { noteAssistantAgent } from '#server/features/notes/agents/note-assistant';
import { replyAgent } from '#server/features/notes/agents/reply';
import { rewriteAgent } from '#server/features/notes/agents/rewrite';
import { convertCapturedMessage } from '#server/features/notes/service/conversion';
import { Notes } from '#server/features/notes/service/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { Agents, generateAgent } from '#server/platform/ai/agents';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';
import { Database } from '#server/platform/database/database';
import { defineActivity, publicationActivity } from '#server/platform/definitions/define-activity';
import type { AgentEnvironment } from '#server/platform/definitions/define-agent';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { impactToken } from '#server/platform/definitions/impact-token';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { retryResumableActivity } from '#server/platform/workflows/retry';

export const noteReplyWorkflow = defineWorkflow({
  name: 'conversation-reply',
  version: 1,
  payload: Schema.Struct({ event: noteGenerationRequestedSchema }),
  success: versionIdSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

const attachmentGate = (sourceId: SourceId, requestId: string) =>
  DurableDeferred.make(`attachment/${sourceId}/${requestId}`, { error: failureSchema });

/** Runs captured reply or conversion work and settles failures through guarded activities. */
export const noteReplyHandler = ({ event }: typeof noteReplyWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const sources = yield* Sources;
    const agents = yield* Agents;
    const database = yield* Database;
    const { store } = database;

    const pending = yield* notes.replyReadiness({ requestId: event.requestId });

    for (const part of pending) {
      const stillPending = yield* notes.replyReadiness({ requestId: event.requestId });

      if (
        stillPending.some(
          (item) => item.sourceId === part.sourceId && item.requestId === part.requestId
        )
      )
        yield* DurableDeferred.await(attachmentGate(part.sourceId, part.requestId));
    }

    yield* publicationActivity(store, {
      name: 'seal-reply-attachments',
      success: replySnapshotSchema,

      execute: notes.sealReplyAttachments({ requestId: event.requestId })
    });
    const preferences = yield* defineActivity({
      name: 'resolve-reply-preferences',
      success: runPreferencesSchema,

      execute: Effect.gen(function* () {
        const snapshot = yield* notes.replySnapshot({ requestId: event.requestId });
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
      defineActivity({
        name: 'generate-reply',
        success: publishReplyInputSchema,

        execute: function* () {
          const snapshot = yield* notes.replySnapshot({ requestId: event.requestId });

          yield* validateReplyEvent(snapshot, event);

          if (snapshot.context) yield* notes.noteContext({ requestId: snapshot.requestId });

          const conversion = replyConversion(snapshot);

          if (conversion) {
            const preflight = notes
              .replySnapshot({ requestId: event.requestId })
              .pipe(Effect.asVoid, Effect.provideService(Database, database));
            const publication = yield* convertCapturedMessage(snapshot, conversion, {
              generate: (definition, input) =>
                generateAgent(definition, input, { maxRetries: 0, preflight })
            });

            yield* preflight;

            return publication;
          }

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

          yield* notes.replySnapshot({ requestId: event.requestId });
          const mode = yield* notes.noteMode(snapshot.noteId);
          const noteScope = yield* notes.noteAssistantScope(snapshot.noteId);
          const options = {
            maxRetries: 0,
            maxSteps: mode === NoteMode.Assistant ? 12 : 5,
            preflight: notes
              .replySnapshot({ requestId: event.requestId })
              .pipe(
                Effect.andThen(
                  snapshot.context ? notes.noteContext({ requestId: event.requestId }) : Effect.void
                ),
                Effect.asVoid,
                Effect.provideService(Database, database)
              )
          };
          const agentServices = {
            ...agents,
            language: preferences.language ?? agents.language,
            searchSources: (query: string) => Effect.sync(() => catalog.search(query)),
            runTool: toolRunnerForReply(mode, notes, database, snapshot, agents.runTool)
          };
          const rewrite = rewriteGeneration(mode, snapshot);
          const text = yield* (
            rewrite
              ? generateAgent(
                  rewriteAgent,
                  {
                    messages: snapshot.messages.map((message) => ({
                      role: message.role,
                      content: message.text
                    })),
                    origin: rewrite.origin,
                    instruction: rewrite.instruction,
                    preferences
                  },
                  options
                )
              : generateAgent(
                  replyAgentForMode(mode, Option.getOrUndefined(noteScope)),
                  {
                    messages: replyMessages(mode, snapshot, preferences, memory)
                  },
                  options
                )
          ).pipe(Effect.provideService(Agents, agentServices), Effect.provide(Settings.layer));
          const citations =
            mode === NoteMode.Assistant
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
        }
      })
    );

    return yield* publicationActivity(store, {
      name: 'publish-reply',
      success: versionIdSchema,

      execute: notes.publishReply(publication)
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const notes = yield* Notes;
        const conversion = yield* notes.inspectReplySnapshot({ requestId: event.requestId }).pipe(
          Effect.match({
            onFailure: () => false,
            onSuccess: (snapshot) => snapshot.generation?.conversion !== undefined
          })
        );

        if (conversion) {
          const { store } = yield* Database;

          yield* publicationActivity(store, {
            name: 'fail-conversion',
            success: Schema.Boolean,

            execute: notes.failConversion(event)
          });
        }

        const assistant = (yield* notes.noteMode(event.noteId)) === NoteMode.Assistant;

        if (
          !conversion &&
          !assistant &&
          ['invalid_input', 'not_found', 'unsupported'].includes(error.kind)
        ) {
          const notes = yield* Notes;
          const { store } = yield* Database;

          yield* publicationActivity(store, {
            name: 'retire-invalid-reply',
            success: Schema.Void,

            execute: notes
              .abandonReply({
                requestId: event.requestId,
                noteId: event.noteId,
                messageId: event.messageId,
                versionId: event.versionId
              })
              .pipe(Effect.asVoid)
          });
        }

        return yield* Effect.fail(error);
      })
    )
  );

export const noteReplyRegistration = defineWorkflowHandler(noteReplyWorkflow, {
  execute: noteReplyHandler,
  triggers: [
    {
      subscription: 'conversation-reply',
      event: 'NoteGenerationRequested',
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

export const noteAttachmentWakeWorkflow = defineWorkflow({
  name: 'conversation-attachment-wake',
  version: 1,
  payload: Schema.Struct({ event: sourceWakeEventSchema }),
  success: Schema.Void,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

export const noteAttachmentWakeHandler = ({
  event
}: typeof noteAttachmentWakeWorkflow.payloadSchema.Type) =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    let after: string | undefined;

    for (;;) {
      const page = yield* notes.replyWakes({ sourceId: event.sourceId, after, limit: 100 });

      function* wakeReply(row: (typeof page)[number]) {
        const readiness = yield* Effect.result(notes.replyReadiness({ requestId: row.requestId }));

        if (Result.isFailure(readiness)) {
          if (!['invalid_input', 'not_found', 'unsupported'].includes(readiness.failure.kind))
            return yield* Effect.fail(readiness.failure);

          for (const part of row.pendingAttachments) {
            const gate = attachmentGate(part.sourceId, part.requestId);

            yield* DurableDeferred.fail(gate, {
              token: DurableDeferred.tokenFromExecutionId(gate, {
                workflow: noteReplyWorkflow,
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
                workflow: noteReplyWorkflow,
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

export const noteAttachmentWakeRegistration = defineWorkflowHandler(noteAttachmentWakeWorkflow, {
  execute: noteAttachmentWakeHandler,
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
});

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
  event: typeof noteGenerationRequestedSchema.Type
) {
  if (
    (snapshot.pendingAttachments?.length ?? 0) > 0 ||
    snapshot.requestId !== event.requestId ||
    snapshot.noteId !== event.noteId ||
    snapshot.messageId !== event.messageId ||
    snapshot.versionId !== event.versionId ||
    replyOperation(snapshot) !== event.operation
  )
    return Effect.fail(new StudyError('invalid_input', 'Reply event identity mismatch'));

  return Effect.void;
}

/** Classifies conversions with rewrites so their workflow status follows the target note. */
function replyOperation(snapshot: typeof replySnapshotSchema.Type) {
  return snapshot.generation?.origin === undefined || snapshot.generation.origin === 'answer'
    ? 'reply'
    : 'rewrite';
}

function replyAgentForMode(mode: NoteMode, scopedNote?: typeof replySnapshotSchema.Type.noteId) {
  if (scopedNote !== undefined) return noteAssistantAgent(scopedNote);

  return mode === NoteMode.Assistant ? assistantAgent : replyAgent;
}

function replyMessages(
  mode: NoteMode,
  snapshot: typeof replySnapshotSchema.Type,
  preferences: typeof runPreferencesSchema.Type,
  memory: typeof assistantMemorySchema.Type | null
) {
  const messages = snapshot.messages
    .filter(
      (message) =>
        mode !== NoteMode.Assistant || !memory || message.messageId > memory.throughMessageId
    )
    .map((message) => ({
      role: message.role,
      content: message.text
    }));

  if (mode === NoteMode.Assistant && memory)
    return [
      {
        role: 'assistant' as const,
        content: 'Summary of earlier note (context, not a new request):\n' + memory.summary
      },
      ...messages
    ];

  if (mode === NoteMode.Assistant || !snapshot.context) return messages;

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
    defineActivity({
      name: 'prepare-assistant-context',
      success: Schema.NullOr(assistantMemorySchema),

      execute: function* () {
        const notes = yield* Notes;
        const snapshot = yield* notes.replySnapshot({ requestId });

        if ((yield* notes.noteMode(snapshot.noteId)) !== NoteMode.Assistant) return null;

        const throughMessageId = snapshot.messages.at(-1)?.messageId;

        if (throughMessageId === undefined) return null;

        const latestMemory = yield* notes.assistantMemory(snapshot.noteId);

        if (memoryAfterQuestion(latestMemory, throughMessageId)) return null;

        const database = yield* Database;
        let plan = yield* notes.assistantCompactionPlan({
          noteId: snapshot.noteId,
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
              preflight: notes
                .replySnapshot({ requestId })
                .pipe(Effect.asVoid, Effect.provideService(Database, database))
            }
          );
          const now = yield* Clock.currentTimeMillis;

          yield* withPublicationGuard(
            database.store,
            notes.saveAssistantMemory({
              noteId: snapshot.noteId,
              throughMessageId: boundary.messageId,
              summary,
              updatedAtMs: BigInt(now)
            })
          );
          plan = yield* notes.assistantCompactionPlan({
            noteId: snapshot.noteId,
            throughMessageId
          });
        }

        return plan.memory;
      }
    })
  );
}

/** Reanswers share receipts with the immutable user question, preventing repeated side effects. */
function durableAssistantTool(
  notes: Context.Service.Shape<typeof Notes>,
  database: Database['Service'],
  versionId: typeof versionIdSchema.Type | undefined
): NonNullable<AgentEnvironment['runTool']> {
  return (call, execute) =>
    Effect.gen(function* () {
      if (versionId === undefined || !call.mutates) return yield* execute;

      const key = { versionId, name: call.name, ordinal: call.ordinal };
      const intent = yield* withPublicationGuard(
        database.store,
        notes.retainAssistantTool({ ...key, input: call.input })
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
        notes.completeAssistantTool({ ...key, result })
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
  mode: NoteMode,
  notes: Context.Service.Shape<typeof Notes>,
  database: Database['Service'],
  snapshot: typeof replySnapshotSchema.Type,
  fallback: AgentEnvironment['runTool']
) {
  return mode === NoteMode.Assistant
    ? durableAssistantTool(notes, database, snapshot.messages.at(-1)?.versionId)
    : fallback;
}

/** Keeps ordinary rewrite inputs separate from answers and registered conversions. */
function rewriteGeneration(mode: NoteMode, snapshot: typeof replySnapshotSchema.Type) {
  if (mode === NoteMode.Assistant) return undefined;

  const generation = snapshot.generation;

  if (!generation || generation.origin === 'answer' || generation.origin === 'convert')
    return undefined;

  return { origin: generation.origin, instruction: generation.instruction };
}

function replyConversion(snapshot: typeof replySnapshotSchema.Type) {
  return snapshot.generation?.conversion;
}
