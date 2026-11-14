import { rpc, useIndependentMutation } from '@study/contracts/react';
import type { Source } from '@study/contracts/sources/schemas';
import { Effect } from 'effect';
import { useState } from 'react';

import { toStudyError } from '#client/lib/study-client/errors.ts';
import { deleteSourceRecovering } from '#client/lib/study-client/source-deletion.ts';

export function useSourceDeletion(source: Source, onDeleted: () => void) {
  const [open, setOpen] = useState(false);
  const preview = rpc.sources.previewDeletion.useQuery({ id: source.id }, { enabled: open });
  const remove = useIndependentMutation((_input: void) =>
    Effect.tryPromise({
      try: async () => {
        await deleteSourceRecovering(source.id);
        setOpen(false);
        onDeleted();
      },
      catch: toStudyError
    })
  );

  function show() {
    remove.reset();
    setOpen(true);
  }

  return { open, setOpen, show, preview, remove };
}
