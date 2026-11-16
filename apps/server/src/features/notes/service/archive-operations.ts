/** @file Owns archive operations within this feature. */

import type { noteArchiveInputSchema, setNoteItemArchivedSchema } from '@study/contracts';
import { transaction } from '@study/server';

import { NoteArchiveStore } from '#server/features/notes/store/archive';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';

import { allArchivedItems } from './archive.ts';

export function noteArchiveOperations() {
  return {
    archivedItems: (input: typeof noteArchiveInputSchema.Type) =>
      transaction((tx) => allArchivedItems(tx, input.noteId)),
    setItemArchived: (input: typeof setNoteItemArchivedSchema.Type) =>
      transaction((tx) => {
        const archivedAt = tx.store(NoteArchiveStore).setItemArchived(input);

        if (input.target.kind === 'page')
          Pages.archiveNoteInTransaction(tx, {
            noteId: input.noteId,
            pageId: input.target.id,
            archivedAt
          });
        else if (input.target.kind === 'source')
          Sources.archiveNoteInTransaction(tx, {
            noteId: input.noteId,
            sourceId: input.target.id,
            archivedAt
          });
      })
  };
}
