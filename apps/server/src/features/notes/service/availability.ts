/** @file Owns availability within this feature. */

import type { NoteId } from '@study/contracts';
import { StudyError } from '@study/contracts';
import type { Transaction } from '@study/server';
import { Option } from 'effect';

import { NoteDeletionStore } from '#server/features/notes/store/deletion';
import { NoteStore } from '#server/features/notes/store/index';

export function requireAvailableNote(tx: Transaction, noteId: NoteId) {
  tx.store(NoteStore).note(noteId);

  if (Option.isSome(tx.store(NoteDeletionStore).findNoteDeletion(noteId)))
    throw new StudyError('not_found', 'Note is unavailable');
}
