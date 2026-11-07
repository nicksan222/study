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
import { eq } from '@study/db';
import { sessions } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

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
              .where(eq(sessions.mode, ConversationMode.Assistant))
              .get()?.id
          )
      })
    },
    mutations: {}
  })
});
