/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists Assistant chat identities, history pagination and compacted memory.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps Assistant note state typed and durably persisted.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private stores own SQLite; public feature services coordinate behavior.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { noteIdSchema } from '@study/contracts/ids';
import {
  assistantChatStartSchema,
  assistantChatsInputSchema,
  assistantCompactionInputSchema,
  assistantCompactionPlanSchema,
  assistantMemorySchema
} from '@study/contracts/notes/assistant';
import { NoteMode } from '@study/contracts/notes/schemas';
import { and, asc, desc, eq, gt, lt, lte, sql, isNull } from '@study/db';
import {
  assistant_chat_starts,
  assistant_memory,
  messages,
  message_versions,
  notes
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
        output: Schema.Option(noteIdSchema),
        run: ({ key }) =>
          Option.fromNullishOr(
            db.orm
              .select()
              .from(assistant_chat_starts)
              .where(eq(assistant_chat_starts.key, key))
              .get()?.note_id
          )
      })
    },
    mutations: {
      retain: storeMutation({
        input: Schema.Struct({ ...assistantChatStartSchema.fields, noteId: noteIdSchema }),
        output: Schema.Void,
        run: ({ key, noteId }) => {
          db.orm.insert(assistant_chat_starts).values({ key, note_id: noteId }).run();
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
        output: Schema.Array(noteIdSchema),
        run: ({ limit, before }) =>
          db.orm
            .select({ id: notes.id })
            .from(notes)
            .where(
              and(
                eq(notes.mode, NoteMode.Assistant),
                isNull(notes.assistant_for_note_id),
                before === undefined ? undefined : lt(notes.id, before)
              )
            )
            .orderBy(desc(notes.id))
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
        input: noteIdSchema,
        output: assistantStateSchema,
        run: (noteId) => {
          const note = db.orm.select().from(notes).where(eq(notes.id, noteId)).get();

          if (note?.mode !== NoteMode.Assistant)
            throw new StudyError('invalid_input', 'Assistant chat required');

          const stored = db.orm
            .select()
            .from(assistant_memory)
            .where(eq(assistant_memory.note_id, noteId))
            .get();
          const memory = stored
            ? {
                noteId,
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
                eq(messages.note_id, noteId),
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
            .where(and(eq(messages.id, input.throughMessageId), eq(messages.note_id, input.noteId)))
            .get();

          if (!message)
            throw new StudyError('invalid_input', 'Memory boundary is outside the note');

          const values = {
            note_id: input.noteId,
            through_message_id: input.throughMessageId,
            summary: input.summary,
            updated_at_ms: input.updatedAtMs
          };

          db.orm
            .insert(assistant_memory)
            .values(values)
            .onConflictDoUpdate({
              target: assistant_memory.note_id,
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
        run: ({ noteId, throughMessageId }) => {
          const stored = db.orm
            .select()
            .from(assistant_memory)
            .where(
              and(
                eq(assistant_memory.note_id, noteId),
                lt(assistant_memory.through_message_id, throughMessageId)
              )
            )
            .get();
          const memory = stored
            ? {
                noteId,
                throughMessageId: stored.through_message_id,
                summary: stored.summary,
                updatedAtMs: stored.updated_at_ms
              }
            : null;
          const condition = and(
            eq(messages.note_id, noteId),
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
