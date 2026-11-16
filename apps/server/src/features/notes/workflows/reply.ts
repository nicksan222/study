/** @file Owns reply within this feature. */

import {
  NoteMode,
  StudyError,
  failureSchema,
  noteGenerationRequestedSchema,
  publishReplyInputSchema,
  replySnapshotSchema,
  runPreferencesSchema,
  versionIdSchema
} from '@study/contracts';
import {
  Agents,
  generateAgent,
  Database,
  defineActivity,
  publicationActivity,
  resumableActivity,
  defineWorkflow,
  defineWorkflowHandler,
  normalizeError
} from '@study/server';
import { Effect, Option, Schema } from 'effect';
import { DurableDeferred } from 'effect/workflow';

import { rewriteAgent } from '#server/features/notes/agents/rewrite';
import { convertCapturedMessage } from '#server/features/notes/service/conversion';
import { Notes } from '#server/features/notes/service/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';

import { prepareAssistantContext, toolRunnerForReply } from './internal/assistant-context.ts';
import { attachmentGate } from './internal/attachment-gate.ts';
import {
  replyAgentForMode,
  replyConversion,
  replyMessages,
  rewriteGeneration,
  selectionCatalog,
  validateReplyEvent
} from './internal/reply-context.ts';

export const noteReplyWorkflow = defineWorkflow({
  name: 'conversation-reply',
  version: 1,
  payload: Schema.Struct({ event: noteGenerationRequestedSchema }),
  success: versionIdSchema,
  error: failureSchema,
  idempotencyKey: ({ event }) => event.eventId
});

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
    const publication = yield* resumableActivity({
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

        const catalog = yield* Effect.try({
          try: () => selectionCatalog(snapshot),
          catch: normalizeError
        });
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

          yield* Effect.try({
            try: () =>
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
              }),
            catch: normalizeError
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
    });

    return yield* publicationActivity(store, {
      name: 'publish-reply',
      success: versionIdSchema,

      execute: notes.publishReply(publication)
    });
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (error) {
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
