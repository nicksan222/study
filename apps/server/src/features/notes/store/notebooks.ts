/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks notebook identity without exposing persistence to tools.                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses canonical feature services and schema-checked operations.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Persistence policy remains in the owning feature service.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { noteIdSchema } from '@study/contracts/ids';
import { NoteMode } from '@study/contracts/notes/schemas';
import { and, eq } from '@study/db';
import { notes } from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

export const NotebookStore = defineStore({
  name: 'study/NoteNotebookStore',
  entity: { singular: 'notebook', plural: 'notebooks' },
  make: ({ db }) => ({
    mutations: {},
    queries: {
      notebook: storeQuery({
        role: 'required',
        input: noteIdSchema,
        output: Schema.Boolean,
        run: (id) =>
          Boolean(
            db.orm
              .select({ id: notes.id })
              .from(notes)
              .where(and(eq(notes.id, id), eq(notes.mode, NoteMode.Notebook)))
              .get()
          )
      })
    }
  })
});
