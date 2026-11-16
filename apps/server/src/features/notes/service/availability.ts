/** @file Owns availability within this feature. */

import type { NoteId } from '@study/contracts';
import { StudyError } from '@study/contracts';
import { Option } from 'effect';

import { NoteDeletionStore } from '#server/features/notes/store/deletion';
import { NoteStore } from '#server/features/notes/store/index';
import type { Transaction } from '#server/platform/definitions/define-store';

export function requireAvailableNote(tx: Transaction, noteId: NoteId) {
  tx.store(NoteStore).note(noteId);

  if (Option.isSome(tx.store(NoteDeletionStore).findNoteDeletion(noteId)))
    throw new StudyError('not_found', 'Note is unavailable');
}
