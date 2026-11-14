import type { noteWorkItemSchema } from '@study/contracts/notes/work';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import { Effect } from 'effect';

import { toStudyError } from '#client/lib/study-client/errors.ts';

export type NoteWorkItem = typeof noteWorkItemSchema.Type;

export function useStopNoteWork() {
  return useIndependentMutation((item: NoteWorkItem) =>
    Effect.tryPromise({
      try: async () => {
        if (item.kind === 'transform')
          await rpc.pages.cancelTransform.call({ requestId: item.requestId });
        else await rpc.workflows.cancelExecution.call({ id: item.execution.id, mode: 'safe' });
      },
      catch: toStudyError
    })
  );
}
