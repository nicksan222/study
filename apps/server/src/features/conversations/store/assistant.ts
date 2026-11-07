/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads conversation modes and the dedicated Assistant conversation identity.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps mode and Assistant identity lookups behind typed store queries.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the canonical sessions table; conversation services own creation and behavior.      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { ConversationMode, conversationModeSchema } from '@study/contracts/conversations/schemas';
import { sessionIdSchema } from '@study/contracts/ids';
import { and, desc, eq, isNull } from '@study/db';
import { sessions } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';

export const SessionModeStore = defineStore({
  name: 'study/SessionModeStore',
  entity: { singular: 'sessionMode', plural: 'sessionModes' },
  make: ({ db }) => ({
    queries: {
      sessionMode: storeQuery({
        role: 'required',
        input: sessionIdSchema,
        output: conversationModeSchema,
        run: (id) =>
          db.orm.select({ mode: sessions.mode }).from(sessions).where(eq(sessions.id, id)).get()
            ?.mode ?? null
      })
    },
    mutations: {}
  })
});

export const AssistantSessionStore = defineStore({
  name: 'study/AssistantSessionStore',
  entity: { singular: 'assistantSession', plural: 'assistantSessions' },
  make: ({ db }) => ({
    queries: {
      findAssistantSession: storeQuery({
        role: 'optional',
        input: Schema.Void,
        output: Schema.Option(sessionIdSchema),
        run: () =>
          Option.fromNullishOr(
            db.orm
              .select({ id: sessions.id })
              .from(sessions)
              .where(
                and(
                  eq(sessions.mode, ConversationMode.Assistant),
                  isNull(sessions.assistant_for_session_id)
                )
              )
              .orderBy(desc(sessions.id))
              .get()?.id
          )
      })
    },
    mutations: {}
  })
});

/** A scoped chat is a child session, so deleting its notebook also deletes the private chat. */
export const SessionAssistantStore = defineStore({
  name: 'study/SessionAssistantStore',
  entity: { singular: 'sessionAssistant', plural: 'sessionAssistants' },
  make: ({ db }) => ({
    queries: {
      findSessionAssistant: storeQuery({
        role: 'optional',
        input: sessionIdSchema,
        output: Schema.Option(sessionIdSchema),
        run: (id) =>
          Option.fromNullishOr(
            db.orm
              .select({ id: sessions.id })
              .from(sessions)
              .where(eq(sessions.assistant_for_session_id, id))
              .get()?.id
          )
      })
    },
    mutations: {
      bind: storeMutation({
        input: Schema.Struct({ chatId: sessionIdSchema, sessionId: sessionIdSchema }),
        output: Schema.Void,
        run: ({ chatId, sessionId }) => {
          db.orm
            .update(sessions)
            .set({ assistant_for_session_id: sessionId })
            .where(eq(sessions.id, chatId))
            .run();
        }
      })
    }
  })
});

export const AssistantScopeStore = defineStore({
  name: 'study/AssistantScopeStore',
  entity: { singular: 'assistantScope', plural: 'assistantScopes' },
  make: ({ db }) => ({
    queries: {
      findAssistantScope: storeQuery({
        role: 'optional',
        input: sessionIdSchema,
        output: Schema.Option(sessionIdSchema),
        run: (id) =>
          Option.fromNullishOr(
            db.orm
              .select({ parent: sessions.assistant_for_session_id })
              .from(sessions)
              .where(eq(sessions.id, id))
              .get()?.parent
          )
      })
    },
    mutations: {}
  })
});
