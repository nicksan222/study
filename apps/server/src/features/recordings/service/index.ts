/** @file Composes recordings application operations behind the feature boundary. */

import type { copyNoteContentSchema } from '@study/contracts';
import { defineService } from '@study/server';
import type { Transaction } from '@study/server';

import { RecordingCopyStore } from '#server/features/recordings/store/copy';

import { recordingOperations } from './recordings.ts';

export const Recordings = defineService('study/Recordings', recordingOperations, {
  copyNotesInTransaction: (tx: Transaction, input: typeof copyNoteContentSchema.Type) =>
    tx.store(RecordingCopyStore).copy(input)
});
