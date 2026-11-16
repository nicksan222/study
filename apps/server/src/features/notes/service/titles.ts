/** @file Owns titles within this feature. */

import type { NoteId, publishTitleInputSchema } from '@study/contracts';

import { TitleStore } from '#server/features/notes/store/title';
import {
  publicationTransaction,
  transaction,
  useStore
} from '#server/platform/definitions/define-store';

export function* noteTitleOperations() {
  const titles = yield* useStore(TitleStore);

  return {
    titleSnapshot: titles.titleSnapshot,
    requestTitle: (input: { noteId: NoteId }) =>
      transaction((tx) => {
        const requestId = crypto.randomUUID();

        const snapshot = tx.store(TitleStore).captureTitle({ ...input, requestId });

        tx.emit({
          type: 'NoteTitleRequested',
          eventId: crypto.randomUUID(),
          causationId: null,
          correlationId: requestId,
          inputVersion: 1,
          depth: 0,
          ...snapshot
        });

        return { requestId, noteId: input.noteId };
      }),
    publishTitle: (input: typeof publishTitleInputSchema.Type) =>
      publicationTransaction((tx) => {
        return tx.store(TitleStore).publishTitle(input);
      })
  };
}
