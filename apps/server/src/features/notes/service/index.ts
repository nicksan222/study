/** @file Composes notes application operations behind the feature boundary. */

import type { createNoteInputSchema } from '@study/contracts';
import { defineService } from '@study/server';
import type { Transaction } from '@study/server';

import { NoteBackupStore } from '#server/features/notes/store/backup';
import { NoteStore } from '#server/features/notes/store/index';

import { noteArchiveOperations } from './archive-operations.ts';
import { noteContextOperations } from './context.ts';
import { noteDeletionOperations } from './deletion.ts';
import { noteLibraryOperations } from './library.ts';
import { noteMessageOperations, postMessage } from './messages.ts';
import { notePageProposalOperations } from './page-proposals.ts';
import { noteQuestionOperations } from './questions.ts';
import { noteReplyOperations } from './replies.ts';
import { noteRequestOperations } from './requests.ts';
import { noteSectionTitleOperations } from './section-titles.ts';
import { noteTitleOperations } from './titles.ts';

export const Notes = defineService(
  'study/Notes',
  function* () {
    return {
      ...noteQuestionOperations(),
      ...notePageProposalOperations(),
      ...noteArchiveOperations(),
      ...(yield* noteContextOperations()),
      ...(yield* noteTitleOperations()),
      ...(yield* noteReplyOperations()),
      ...(yield* noteRequestOperations()),
      ...noteMessageOperations(),
      ...noteSectionTitleOperations(),
      ...(yield* noteLibraryOperations()),
      ...noteDeletionOperations()
    };
  },
  {
    createNoteInTransaction: (tx: Transaction, input: typeof createNoteInputSchema.Type) =>
      tx.store(NoteStore).createNote({ ...input, titleSource: 'user' }),
    postMessageInTransaction: postMessage,
    validateBackup: (tx: Transaction, requireRetired = false) =>
      tx.store(NoteBackupStore).backupNote(requireRetired)
  }
);
