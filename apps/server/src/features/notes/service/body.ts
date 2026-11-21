/** @file Applies notebook availability and mode checks to full-body Markdown operations. */

import type { noteBodyInputSchema, saveNoteBodyInputSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import type { Transaction } from '@study/server';
import { transaction } from '@study/server';

import { NoteBodyStore } from '#server/features/notes/store/body';
import { NotebookStore } from '#server/features/notes/store/notebooks';

import { requireAvailableNote } from './availability.ts';

function requireNotebook(tx: Transaction, { noteId }: typeof noteBodyInputSchema.Type) {
  requireAvailableNote(tx, noteId);

  if (!tx.store(NotebookStore).notebook(noteId))
    throw new StudyError('not_found', 'Notebook note not found');
}

export function saveBodyInTransaction(tx: Transaction, input: typeof saveNoteBodyInputSchema.Type) {
  requireNotebook(tx, input);

  return tx.store(NoteBodyStore).saveBody(input);
}

export function noteBodyOperations() {
  return {
    body: (input: typeof noteBodyInputSchema.Type) =>
      transaction((tx) => {
        requireNotebook(tx, input);

        return tx.store(NoteBodyStore).body(input);
      }),
    saveBody: (input: typeof saveNoteBodyInputSchema.Type) =>
      transaction((tx) => saveBodyInTransaction(tx, input))
  };
}
