/** @file Composes recordings application operations behind the feature boundary. */

import type { copyNoteContentSchema } from '@study/contracts';

import { RecordingCopyStore } from '#server/features/recordings/store/copy';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';

import { recordingOperations } from './recordings.ts';

export const Recordings = defineService(
  'study/Recordings',
  function* () {
    return {
      ...(yield* recordingOperations())
    };
  },
  {
    copyNotesInTransaction: (tx: Transaction, input: typeof copyNoteContentSchema.Type) =>
      tx.store(RecordingCopyStore).copy(input)
  }
);
