/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists Assistant chat identities, history pagination and compacted memory.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps Assistant conversation state typed and durably persisted.                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private stores own SQLite; public feature services coordinate behavior.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  assistantChatStartSchema,
  assistantChatsInputSchema,
  assistantCompactionInputSchema,
  assistantCompactionPlanSchema,
  assistantMemorySchema
} from '@study/contracts/conversations/assistant';
import { ConversationMode } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { and, asc, desc, eq, gt, lt, lte, sql, isNull } from '@study/db';
import {
  assistant_chat_starts,
  assistant_memory,
  messages,
  message_versions,
  sessions
} from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';

export const AssistantChatStartStore = defineStore({
  name: 'study/AssistantChatStartStore',
  entity: { singular: 'assistantChatStart', plural: 'assistantChatStarts' },
  make: ({ db }) => ({
    queries: {
      findAssistantChatStart: storeQuery({
        role: 'optional',
        input: assistantChatStartSchema,
        output: Schema.Option(sessionIdSchema),
        run: ({ key }) =>
          Option.fromNullishOr(
            db.orm
              .select()
              .from(assistant_chat_starts)
              .where(eq(assistant_chat_starts.key, key))
              .get()?.session_id
          )
      })
    },
    mutations: {
      retain: storeMutation({
        input: Schema.Struct({ ...assistantChatStartSchema.fields, sessionId: sessionIdSchema }),
        output: Schema.Void,
        run: ({ key, sessionId }) => {
          db.orm.insert(assistant_chat_starts).values({ key, session_id: sessionId }).run();
        }
      })
    }
  })
});

export const AssistantChatsStore = defineStore({
  name: 'study/AssistantChatsStore',
  entity: { singular: 'assistantChat', plural: 'assistantChats' },
  make: ({ db }) => ({
    queries: {
      assistantChats: storeQuery({
        role: 'collection',
        input: assistantChatsInputSchema,
        output: Schema.Array(sessionIdSchema),
        run: ({ limit, before }) =>
          db.orm
            .select({ id: sessions.id })
            .from(sessions)
            .where(
              and(
                eq(sessions.mode, ConversationMode.Assistant),
                isNull(sessions.assistant_for_session_id),
                before === undefined ? undefined : lt(sessions.id, before)
              )
            )
            .orderBy(desc(sessions.id))
            .limit(limit)
            .all()
            .map((row) => row.id)
      })
    },
    mutations: {}
  })
});

const assistantStateSchema = Schema.Struct({
  memory: Schema.NullOr(assistantMemorySchema),
  characters: Schema.Int
});

export const AssistantStateStore = defineStore({
  name: 'study/AssistantStateStore',
  entity: { singular: 'assistantState', plural: 'assistantStates' },
  make: ({ db }) => ({
    queries: {
      assistantState: storeQuery({
        role: 'required',
        input: sessionIdSchema,
        output: assistantStateSchema,
        run: (sessionId) => {
          const session = db.orm.select().from(sessions).where(eq(sessions.id, sessionId)).get();

          if (session?.mode !== ConversationMode.Assistant)
            throw new StudyError('invalid_input', 'Assistant chat required');

          const stored = db.orm
            .select()
            .from(assistant_memory)
            .where(eq(assistant_memory.session_id, sessionId))
            .get();
          const memory = stored
            ? {
                sessionId,
                throughMessageId: stored.through_message_id,
                summary: stored.summary,
                updatedAtMs: stored.updated_at_ms
              }
            : null;
          const count = db.orm
            .select({ characters: sql<number>`coalesce(sum(length(${message_versions.text})),0)` })
            .from(messages)
            .innerJoin(message_versions, eq(messages.active_version_id, message_versions.id))
            .where(
              and(
                eq(messages.session_id, sessionId),
                eq(message_versions.status, 'complete'),
                memory ? gt(messages.id, memory.throughMessageId) : undefined
              )
            )
            .get();

          return { memory, characters: Number(count?.characters ?? 0) };
        }
      })
    },
    mutations: {
      saveMemory: storeMutation({
        input: assistantMemorySchema,
        output: assistantMemorySchema,
        run: (input) => {
          const message = db.orm
            .select()
            .from(messages)
            .where(
              and(eq(messages.id, input.throughMessageId), eq(messages.session_id, input.sessionId))
            )
            .get();

          if (!message)
            throw new StudyError('invalid_input', 'Memory boundary is outside the conversation');

          const values = {
            session_id: input.sessionId,
            through_message_id: input.throughMessageId,
            summary: input.summary,
            updated_at_ms: input.updatedAtMs
          };

          db.orm
            .insert(assistant_memory)
            .values(values)
            .onConflictDoUpdate({
              target: assistant_memory.session_id,
              set: values,
              setWhere: sql`${assistant_memory.through_message_id} <= ${input.throughMessageId}`
            })
            .run();

          return input;
        }
      })
    }
  })
});

/** Read unsummarized messages from SQLite, including turns outside the bounded reply snapshot. */
export const AssistantCompactionStore = defineStore({
  name: 'study/AssistantCompactionStore',
  entity: { singular: 'assistantCompaction', plural: 'assistantCompactions' },
  make: ({ db }) => ({
    queries: {
      assistantCompaction: storeQuery({
        role: 'required',
        input: assistantCompactionInputSchema,
        output: assistantCompactionPlanSchema,
        run: ({ sessionId, throughMessageId }) => {
          const stored = db.orm
            .select()
            .from(assistant_memory)
            .where(
              and(
                eq(assistant_memory.session_id, sessionId),
                lt(assistant_memory.through_message_id, throughMessageId)
              )
            )
            .get();
          const memory = stored
            ? {
                sessionId,
                throughMessageId: stored.through_message_id,
                summary: stored.summary,
                updatedAtMs: stored.updated_at_ms
              }
            : null;
          const condition = and(
            eq(messages.session_id, sessionId),
            eq(message_versions.status, 'complete'),
            lte(messages.id, throughMessageId),
            memory ? gt(messages.id, memory.throughMessageId) : undefined
          );
          const count = db.orm
            .select({ characters: sql<number>`coalesce(sum(length(${message_versions.text})),0)` })
            .from(messages)
            .innerJoin(message_versions, eq(messages.active_version_id, message_versions.id))
            .where(condition)
            .get();
          const rows = db.orm
            .select({ messageId: messages.id, role: messages.role, text: message_versions.text })
            .from(messages)
            .innerJoin(message_versions, eq(messages.active_version_id, message_versions.id))
            .where(condition)
            .orderBy(asc(messages.id))
            .limit(1000)
            .all();
          const prefix: typeof rows = [];
          let size = 0;

          for (const row of rows) {
            if (
              row.messageId === throughMessageId ||
              (prefix.length > 0 && size + row.text.length > 120000)
            )
              break;

            prefix.push(row);
            size += row.text.length;
          }

          return { memory, characters: Number(count?.characters ?? 0), messages: prefix };
        }
      })
    },
    mutations: {}
  })
});
