import type { NoteId } from '@study/contracts/ids';
import { useIndependentMutation } from '@study/contracts/react';
import { Effect } from 'effect';

import { toStudyError } from '#client/lib/study-client/errors.ts';

/** Composed note actions own independent results; committed revisions refresh all readers. */
export function useNoteMutation<Variables, Output>(
  _noteId: NoteId,
  mutationFn: (variables: Variables) => Promise<Output>
) {
  return useIndependentMutation((variables: Variables) =>
    Effect.tryPromise({
      try: () => mutationFn(variables),
      catch: toStudyError
    })
  );
}
