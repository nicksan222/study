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
import type { noteSchema } from '@study/contracts/notes/schemas';

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
    let before: { updatedAt: bigint; id: NoteId } | undefined;
    let existing: ReturnType<typeof store.note> | undefined;

    for (;;) {
      const page = store.notes({ limit: 100, project: input.project ?? null, before });

      for (const note of page) existing = earlierMatch(title, existing, note);

      const last = page.at(-1);

      if (page.length < 100 || !last) break;

      before = { updatedAt: last.updatedAt, id: last.id };
    }

    return existing ?? store.createNote({ ...input, title, titleSource: 'user' });
  });

/** Agent notebook tools cannot inspect or mutate private Assistant notes. */
export const notebookNote = (id: NoteId) =>
  transaction((tx) => {
    if (!tx.store(NotebookStore).notebook(id))
      throw new StudyError('not_found', 'Notebook note not found');

    return tx.store(NoteStore).note(id);
  });

function earlierMatch(
  title: string,
  existing: typeof noteSchema.Type | undefined,
  candidate: typeof noteSchema.Type
) {
  if (candidate.archivedAt !== null || candidate.title !== title) return existing;

  return !existing || candidate.id < existing.id ? candidate : existing;
}
