/** @file Owns selection within this feature. */

import {
  StudyError,
  noteSelectionInputSchema,
  noteSelectionSchema,
  updateNoteSelectionSchema
} from '@study/contracts';
import { and, eq, notes } from '@study/db';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

import { makeContextReads } from './context-reads.ts';
import { targetsCodec } from './context-schemas.ts';

export const NoteSelectionStore = defineStore({
  name: 'study/NoteSelectionStore',
  entity: { singular: 'noteSelection', plural: 'noteSelections' },
  make: (resources) => {
    const { db } = resources;

    const { note, selection } = makeContextReads(resources);

    return {
      queries: {
        noteSelection: storeQuery({
          role: 'required',
          input: noteSelectionInputSchema,
          output: noteSelectionSchema,
          run: selection
        })
      },
      mutations: {
        updateSelection: storeMutation({
          changes: ['notes'],
          input: updateNoteSelectionSchema,
          output: noteSelectionSchema,
          run: (input) => {
            const row = note(input.noteId);

            if (row.selection_revision !== input.expectedRevision)
              throw new StudyError('invalid_input', 'Note selection changed');

            db.orm
              .update(notes)
              .set({
                selection_revision: row.selection_revision + 1n,
                selection: Schema.encodeSync(targetsCodec)(input.targets)
              })
              .where(
                and(
                  eq(notes.id, input.noteId),
                  eq(notes.selection_revision, input.expectedRevision)
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
