/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists guarded session selections and immutable logical conversation captures.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Stores exact bounded message versions and typed captured intent.                       │
 * │ - Reads retained captures separately from availability-checked resume inputs.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversations owns these private records; Materials resolves canonical                   │
 * │ selected content.                                                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  captureSessionContextSchema,
  runSelectionContextSchema,
  sessionSelectionInputSchema,
  sessionSelectionSchema,
  updateSessionSelectionSchema,
  selectionTargetsSchema,
  resolvedSelectionSchema
} from '@study/contracts/conversations/context';
import { replySnapshotInputSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { and, eq } from '@study/db';
import {
  sessions,
  session_run_contexts,
  messages,
  message_parts,
  message_versions,
  material_deletion_requests
} from '@study/db/schema';
import { Schema, Option } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeHistory } from './history.ts';

const targetsCodec = Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema));

const contextCodec = Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema));

const intentCodec = Schema.fromJsonString(Schema.toCodecJson(captureSessionContextSchema));

const sameIntent = Schema.toEquivalence(captureSessionContextSchema);

function assertHistoryBoundary(
  history: typeof runSelectionContextSchema.Type.messages,
  throughMessageId: typeof captureSessionContextSchema.Type.throughMessageId
) {
  if (throughMessageId !== undefined && history.at(-1)?.messageId !== throughMessageId)
    throw new StudyError('invalid_input', 'Conversation boundary is unavailable in this scope');
}

function canonicalIntent(input: typeof captureSessionContextSchema.Type) {
  return {
    sessionId: input.sessionId,
    threadRoot: input.threadRoot,
    throughMessageId: input.throughMessageId,
    intentKey: input.intentKey,
    instruction: input.instruction,
    preferences: {
      language: input.preferences.language,
      detail: input.preferences.detail
    }
  };
}

function makeContextReads({ db }: StoreResources) {
  function session(id: typeof sessionSelectionInputSchema.Type.sessionId) {
    const row = db.orm.select().from(sessions).where(eq(sessions.id, id)).get();

    if (!row) throw new StudyError('not_found', 'Session is unavailable');

    return row;
  }

  function selection(input: typeof sessionSelectionInputSchema.Type) {
    const row = session(input.sessionId);

    return {
      revision: row.selection_revision,
      targets: Schema.decodeUnknownSync(targetsCodec)(row.selection)
    };
  }

  function decodeContext(value: string) {
    const snapshot = Schema.decodeUnknownSync(contextCodec)(value);

    for (const item of snapshot.messages) {
      const version = db.orm
        .select()
        .from(message_versions)
        .where(
          and(
            eq(message_versions.id, item.versionId),
            eq(message_versions.message_id, item.messageId)
          )
        )
        .get();

      if (!version || version.text !== item.text || version.status !== 'complete')
        throw new StudyError('not_found', 'Captured conversation version is unavailable');
    }

    return snapshot;
  }

  function retainedContext(requestId: string) {
    return db.orm
      .select()
      .from(session_run_contexts)
      .where(eq(session_run_contexts.request_id, requestId))
      .get();
  }

  function requiredContext(requestId: string, available: boolean) {
    if (
      db.orm
        .select()
        .from(material_deletion_requests)
        .where(eq(material_deletion_requests.request_id, requestId))
        .get()
    )
      throw new StudyError('not_found', 'Captured context is unavailable');
    const row = retainedContext(requestId);

    if (!row) throw new StudyError('not_found', 'Captured context is unavailable');

    return available
      ? decodeContext(row.snapshot)
      : Schema.decodeUnknownSync(contextCodec)(row.snapshot);
  }

  return { session, selection, decodeContext, retainedContext, requiredContext };
}

export const SessionSelectionStore = defineStore({
  name: 'study/SessionSelectionStore',
  entity: { singular: 'sessionSelection', plural: 'sessionSelections' },
  make: (resources) => {
    const { db } = resources;
    const { session, selection } = makeContextReads(resources);

    return {
      queries: {
        sessionSelection: storeQuery({
          role: 'required',
          input: sessionSelectionInputSchema,
          output: sessionSelectionSchema,
          run: selection
        })
      },
      mutations: {
        updateSelection: storeMutation({
          input: updateSessionSelectionSchema,
          output: sessionSelectionSchema,
          run: (input) => {
            const row = session(input.sessionId);

            if (row.selection_revision !== input.expectedRevision)
              throw new StudyError('invalid_input', 'Session selection changed');

            db.orm
              .update(sessions)
              .set({
                selection_revision: row.selection_revision + 1n,
                selection: Schema.encodeSync(targetsCodec)(input.targets)
              })
              .where(
                and(
                  eq(sessions.id, input.sessionId),
                  eq(sessions.selection_revision, input.expectedRevision)
                )
              )
              .run();

            return selection(input);
          }
        })
      }
    };
  }
});

export const RetainedSessionContextStore = defineStore({
  name: 'study/RetainedSessionContextStore',
  entity: { singular: 'retainedSessionContext', plural: 'retainedSessionContexts' },
  make: (resources) => {
    const { requiredContext } = makeContextReads(resources);

    return {
      queries: {
        retainedSessionContext: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: runSelectionContextSchema,
          run: ({ requestId }) => requiredContext(requestId, false)
        })
      },
      mutations: {}
    };
  }
});

export const SessionContextIntentStore = defineStore({
  name: 'study/SessionContextIntentStore',
  entity: { singular: 'sessionContextIntent', plural: 'sessionContextIntents' },
  make: (resources) => {
    const { db } = resources;
    const { decodeContext } = makeContextReads(resources);

    return {
      queries: {
        findSessionContextIntent: storeQuery({
          role: 'optional',
          input: captureSessionContextSchema,
          output: Schema.Option(runSelectionContextSchema),
          run: (input) => {
            const row = db.orm
              .select()
              .from(session_run_contexts)
              .where(
                and(
                  eq(session_run_contexts.session_id, input.sessionId),
                  eq(session_run_contexts.intent_key, input.intentKey)
                )
              )
              .get();

            if (!row) return Option.none();

            if (
              !sameIntent(
                canonicalIntent(Schema.decodeUnknownSync(intentCodec)(row.intent)),
                canonicalIntent(input)
              )
            )
              throw new StudyError('invalid_input', 'Intent key already captures different work');

            return Option.some(decodeContext(row.snapshot));
          }
        })
      },
      mutations: {}
    };
  }
});

export const SessionContextStore = defineStore({
  name: 'study/SessionContextStore',
  entity: { singular: 'sessionContext', plural: 'sessionContexts' },
  make: (resources) => {
    const { db } = resources;
    const { session, requiredContext, retainedContext, decodeContext } =
      makeContextReads(resources);
    const { conversationHistory, conversationRoot } = makeHistory(resources);

    return {
      queries: {
        sessionContext: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: runSelectionContextSchema,
          run: ({ requestId }) => requiredContext(requestId, true)
        }),
        findSessionContext: storeQuery({
          role: 'optional',
          input: replySnapshotInputSchema,
          output: Schema.Option(runSelectionContextSchema),
          run: ({ requestId }) => {
            if (
              db.orm
                .select()
                .from(material_deletion_requests)
                .where(eq(material_deletion_requests.request_id, requestId))
                .get()
            )
              throw new StudyError('not_found', 'Captured context is unavailable');
            const row = retainedContext(requestId);

            return row ? Option.some(decodeContext(row.snapshot)) : Option.none();
          }
        })
      },
      mutations: {
        capture: storeMutation({
          input: Schema.Struct({
            ...captureSessionContextSchema.fields,
            requestId: Schema.String,
            inputs: Schema.Array(resolvedSelectionSchema)
          }),
          output: runSelectionContextSchema,
          run: (input) => {
            const row = session(input.sessionId);
            let history = conversationHistory(
              row.id,
              input.throughMessageId,
              input.threadRoot,
              true
            );

            if (input.threadRoot !== undefined) {
              const part = db.orm
                .select()
                .from(message_parts)
                .where(eq(message_parts.id, input.threadRoot))
                .get();

              if (!part) throw new StudyError('not_found', 'Thread root is unavailable');

              const root = conversationRoot(row.id, part.message_id);
              let size = root.text.length + history.reduce((n, item) => n + item.text.length, 0);

              while (size > 200000 && history.length > 1) size -= history.shift()!.text.length;

              if (size > 200000)
                throw new StudyError('invalid_input', 'Thread context exceeds limit');

              history = [root, ...history];
            }

            assertHistoryBoundary(history, input.throughMessageId);

            const total = db.orm
              .select()
              .from(messages)
              .where(eq(messages.session_id, row.id))
              .all().length;
            const intent = {
              sessionId: input.sessionId,
              intentKey: input.intentKey,
              instruction: input.instruction,
              preferences: input.preferences,
              threadRoot: input.threadRoot,
              throughMessageId: input.throughMessageId
            };
            const snapshot = {
              ...intent,
              requestId: input.requestId,
              selectionRevision: row.selection_revision,
              inputs: input.inputs,
              messages: history,
              excludedMessages: total - history.length
            };

            if (!history.length && !input.inputs.length)
              throw new StudyError(
                'invalid_input',
                'Context has no selected input or conversation'
              );

            db.orm
              .insert(session_run_contexts)
              .values({
                request_id: input.requestId,
                session_id: row.id,
                intent_key: input.intentKey,
                intent: Schema.encodeSync(intentCodec)(intent),
                snapshot: Schema.encodeSync(contextCodec)(snapshot)
              })
              .run();

            return snapshot;
          }
        })
      }
    };
  }
});

/** Conservative validity for captured selection and active versions of relevant messages. */
export const SessionContextValidityStore = defineStore({
  name: 'study/SessionContextValidityStore',
  entity: { singular: 'sessionContextValidity', plural: 'sessionContextValidities' },
  make: (resources) => {
    const { db } = resources;
    const { requiredContext, session } = makeContextReads(resources);

    return {
      queries: {
        sessionContextValidity: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: Schema.Boolean,
          run: ({ requestId }) => {
            const captured = requiredContext(requestId, true);
            const owner = session(captured.sessionId);

            return (
              owner.selection_revision === captured.selectionRevision &&
              captured.messages.every(
                (item) =>
                  db.orm.select().from(messages).where(eq(messages.id, item.messageId)).get()
                    ?.active_version_id === item.versionId
              )
            );
          }
        })
      },
      mutations: {}
    };
  }
});
