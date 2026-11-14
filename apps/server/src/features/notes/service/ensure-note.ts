/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reuses exact named notebook notes in an atomic transaction.                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses canonical feature services and schema-checked operations.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Persistence policy remains in the owning feature service.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { NoteId } from '@study/contracts/ids';
import type { createNoteInputSchema } from '@study/contracts/notes/rpc';
import { Option } from 'effect';

import { NoteStore } from '#server/features/notes/store/index';
import { NotebookStore } from '#server/features/notes/store/notebooks';
import { transaction } from '#server/platform/definitions/define-store';

/** Exact names are scoped to their subject; retries retain the earliest matching note. */
export const ensureNote = (input: typeof createNoteInputSchema.Type) =>
  transaction((tx) => {
    const title = input.title.trim();

    if (!title || [...title].length > 200)
      throw new StudyError('invalid_input', 'invalid note title');

    const store = tx.store(NoteStore);
    const existing = store.findNotebookByTitle({ ...input, title });

    return Option.getOrElse(existing, () =>
      store.createNote({ ...input, title, titleSource: 'user' })
    );
  });

/** Agent notebook tools cannot inspect or mutate private Assistant notes. */
export const notebookNote = (id: NoteId) =>
  transaction((tx) => {
    if (!tx.store(NotebookStore).notebook(id))
      throw new StudyError('not_found', 'Notebook note not found');

    return tx.store(NoteStore).note(id);
  });
