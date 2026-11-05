/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists guarded session selections and immutable logical conversation captures.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Stores exact bounded message versions and typed captured intent.                       │
 * │ - Reads retained captures separately from availability-checked resume inputs.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversations owns these private records; public content owners resolve canonical        │
 * │ selected content.                                                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  sessionContextIntentSchema,
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
  session_context_documents,
  session_context_sources,
  session_retired_intents,
  messages,
  message_parts,
  message_versions,
  session_deletions
} from '@study/db/schema';
import { Schema, Option } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeAssertContextAvailable } from './context-availability.ts';
import { makeHistory } from './history.ts';

const targetsCodec = Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema));

const contextCodec = Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema));

const intentCodec = Schema.fromJsonString(Schema.toCodecJson(sessionContextIntentSchema));

const sameIntent = Schema.toEquivalence(sessionContextIntentSchema);

function assertHistoryBoundary(
  history: typeof runSelectionContextSchema.Type.messages,
  throughMessageId: typeof sessionContextIntentSchema.Type.throughMessageId
) {
  if (throughMessageId !== undefined && history.at(-1)?.messageId !== throughMessageId)
    throw new StudyError('invalid_input', 'Conversation boundary is unavailable in this scope');
}

function canonicalIntent(input: typeof sessionContextIntentSchema.Type) {
  return {
    sessionId: input.sessionId,
    additionalSessionIds: input.additionalSessionIds,
    threadRoot: input.threadRoot,
    throughMessageId: input.askDigest ? undefined : input.throughMessageId,
    askDigest: input.askDigest,
    intentKey: input.intentKey,
    instruction: input.instruction,
    preferences: {
      language: input.preferences.language,
      detail: input.preferences.detail
    }
  };
}

function makeContextReads({ db, clock }: StoreResources) {
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

    for (const id of [snapshot.sessionId, ...(snapshot.additionalSessionIds ?? [])]) {
      if (db.orm.select().from(session_deletions).where(eq(session_deletions.session_id, id)).get())
        throw new StudyError('not_found', 'Captured session is unavailable');
    }

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

  const assertContextAvailable = makeAssertContextAvailable({ db, clock });

  function requiredContext(requestId: string, available: boolean) {
    assertContextAvailable(requestId, available);

    const row = retainedContext(requestId);

    if (!row) throw new StudyError('not_found', 'Captured context is unavailable');

    return available
      ? decodeContext(row.snapshot)
      : Schema.decodeUnknownSync(contextCodec)(row.snapshot);
  }

  return {
    session,
    selection,
    decodeContext,
    retainedContext,
    requiredContext,
    assertContextAvailable
  };
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

    const { decodeContext, assertContextAvailable } = makeContextReads(resources);

    return {
      queries: {
        findSessionContextIntent: storeQuery({
          role: 'optional',
          input: sessionContextIntentSchema,
          output: Schema.Option(runSelectionContextSchema),
          run: (input) => {
            if (
              db.orm
                .select()
                .from(session_retired_intents)
                .where(
                  and(
                    eq(session_retired_intents.session_id, input.sessionId),
                    eq(session_retired_intents.intent_key, input.intentKey)
                  )
                )
                .get()
            )
              throw new StudyError('not_found', 'Captured input history is unavailable');

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

            assertContextAvailable(row.request_id);

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

    const { session, requiredContext, retainedContext, decodeContext, assertContextAvailable } =
      makeContextReads(resources);

    const { conversationHistory, conversationRoot } = makeHistory(resources);

    function captureHistory(input: typeof sessionContextIntentSchema.Type) {
      let history = conversationHistory(
        input.sessionId,
        input.throughMessageId,
        input.threadRoot,
        true,
        input.throughMessageId === undefined ? {} : { pendingAssistant: 'omit' }
      );

      if (input.threadRoot !== undefined) {
        const part = db.orm
          .select()
          .from(message_parts)
          .where(eq(message_parts.id, input.threadRoot))
          .get();

        if (!part) throw new StudyError('not_found', 'Thread root is unavailable');

        const root = conversationRoot(input.sessionId, part.message_id);
        const size = root.text.length + history.reduce((n, item) => n + item.text.length, 0);

        if (size > 200000) throw new StudyError('not_enough', 'Thread context exceeds limit');

        history = [root, ...history];
      }

      assertHistoryBoundary(history, input.throughMessageId);

      return history;
    }

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
            assertContextAvailable(requestId);

            const row = retainedContext(requestId);

            return row ? Option.some(decodeContext(row.snapshot)) : Option.none();
          }
        })
      },
      mutations: {
        capture: storeMutation({
          input: Schema.Struct({
            ...sessionContextIntentSchema.fields,
            requestId: Schema.String,
            inputs: Schema.Array(resolvedSelectionSchema)
          }),
          output: runSelectionContextSchema,
          run: (input) => {
            const row = session(input.sessionId);

            let history = captureHistory(input);

            const total = db.orm
              .select()
              .from(messages)
              .where(eq(messages.session_id, row.id))
              .all().length;

            const includedSessions = input.additionalSessionIds?.map((sessionId) => {
              const included = session(sessionId);

              history = [...history, ...conversationHistory(sessionId, undefined, undefined, true)];

              return {
                sessionId,
                title: included.title,
                selectionRevision: included.selection_revision
              };
            });

            if (history.reduce((size, item) => size + item.text.length, 0) > 200000)
              throw new StudyError('not_enough', 'Combined conversation context exceeds limit');

            const intent = {
              additionalSessionIds: input.additionalSessionIds,
              sessionId: input.sessionId,
              intentKey: input.intentKey,
              instruction: input.instruction,
              preferences: input.preferences,
              threadRoot: input.threadRoot,
              throughMessageId: input.throughMessageId,
              askDigest: input.askDigest
            };

            const snapshot = {
              ...intent,
              requestId: input.requestId,
              selectionRevision: row.selection_revision,
              inputs: input.inputs,
              messages: history,
              includedSessions,
              excludedMessages:
                total +
                (input.additionalSessionIds ?? []).reduce(
                  (count, id) =>
                    count +
                    db.orm.select().from(messages).where(eq(messages.session_id, id)).all().length,
                  0
                ) -
                history.length
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

            for (const selected of input.inputs) {
              const reference = selected.input;

              if (reference.kind === 'document')
                db.orm
                  .insert(session_context_documents)
                  .values({ request_id: input.requestId, version_id: reference.versionId })
                  .onConflictDoNothing()
                  .run();
              else
                db.orm
                  .insert(session_context_sources)
                  .values({
                    request_id: input.requestId,
                    source_id: reference.sourceId,
                    revision: reference.revision,
                    snapshot_id: reference.snapshotId
                  })
                  .onConflictDoNothing()
                  .run();
            }

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
              (captured.includedSessions ?? []).every(
                (item) => session(item.sessionId).selection_revision === item.selectionRevision
              ) &&
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
