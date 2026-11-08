/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads note modes and the dedicated Assistant note identity.                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps mode and Assistant identity lookups behind typed store queries.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the canonical notes table; note services own creation and behavior.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { noteIdSchema } from '@study/contracts/ids';
import { NoteMode, noteModeSchema } from '@study/contracts/notes/schemas';
import { and, desc, eq, isNull } from '@study/db';
import { notes } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';

export const NoteModeStore = defineStore({
  name: 'study/NoteModeStore',
  entity: { singular: 'noteMode', plural: 'noteModes' },
  make: ({ db }) => ({
    queries: {
      noteMode: storeQuery({
        role: 'required',
        input: noteIdSchema,
        output: noteModeSchema,
        run: (id) =>
          db.orm.select({ mode: notes.mode }).from(notes).where(eq(notes.id, id)).get()?.mode ??
          null
      })
    },
    mutations: {}
  })
});

export const AssistantNoteStore = defineStore({
  name: 'study/AssistantNoteStore',
  entity: { singular: 'assistantNote', plural: 'assistantNotes' },
  make: ({ db }) => ({
    queries: {
      findAssistantNote: storeQuery({
        role: 'optional',
        input: Schema.Void,
        output: Schema.Option(noteIdSchema),
        run: () =>
          Option.fromNullishOr(
            db.orm
              .select({ id: notes.id })
              .from(notes)
              .where(and(eq(notes.mode, NoteMode.Assistant), isNull(notes.assistant_for_note_id)))
              .orderBy(desc(notes.id))
              .get()?.id
          )
      })
    },
    mutations: {}
  })
});

/** A scoped chat is a child note, so deleting its notebook also deletes the private chat. */
export const NoteAssistantStore = defineStore({
  name: 'study/NoteAssistantStore',
  entity: { singular: 'noteAssistant', plural: 'noteAssistants' },
  make: ({ db }) => ({
    queries: {
      findNoteAssistant: storeQuery({
        role: 'optional',
        input: noteIdSchema,
        output: Schema.Option(noteIdSchema),
        run: (id) =>
          Option.fromNullishOr(
            db.orm
              .select({ id: notes.id })
              .from(notes)
              .where(eq(notes.assistant_for_note_id, id))
              .get()?.id
          )
      })
    },
    mutations: {
      bind: storeMutation({
        input: Schema.Struct({ chatId: noteIdSchema, noteId: noteIdSchema }),
        output: Schema.Void,
        run: ({ chatId, noteId }) => {
          db.orm
            .update(notes)
            .set({ assistant_for_note_id: noteId })
            .where(eq(notes.id, chatId))
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
        input: noteIdSchema,
        output: Schema.Option(noteIdSchema),
        run: (id) =>
          Option.fromNullishOr(
            db.orm
              .select({ parent: notes.assistant_for_note_id })
              .from(notes)
              .where(eq(notes.id, id))
              .get()?.parent
          )
      })
    },
    mutations: {}
  })
});
