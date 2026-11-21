import type { Page } from '@study/contracts';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import { useNavigate } from '@tanstack/react-router';
import { Effect } from 'effect';
import { useState } from 'react';

import { toStudyError } from '#client/lib/study-client/errors.ts';

export function usePageRetirement(
  page: Page,
  initialMode?: 'history' | 'deletion',
  onClosed?: () => void
) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'history' | 'deletion' | undefined>(initialMode);
  const [keepLatest, setKeepLatest] = useState('10');
  const count = Number(keepLatest);
  const validKeep = Number.isInteger(count) && count >= 1 && count <= 1000;
  const deletion = rpc.pages.previewDeletion.useQuery(
    { id: page.id },
    { enabled: mode === 'deletion' }
  );
  const history = rpc.pages.previewHistory.useQuery(
    { pageId: page.id, keepLatest: count },
    { enabled: mode === 'history' && validKeep }
  );
  const inspect = mode === 'deletion' ? deletion : history;
  const preview = inspect.isSuccess && !inspect.isFetching ? inspect.data : undefined;
  const retire = useIndependentMutation((_input: void) =>
    Effect.tryPromise({
      try: async () => {
        if (!preview) return;

        if (mode === 'deletion') {
          await rpc.pages.delete.call({ pageId: page.id, token: preview.token });
          await navigate({
            to: '/practice',
            search: page.projectIds[0] ? { project: String(page.projectIds[0]) } : {}
          });
        } else
          await rpc.pages.retireHistory.call({
            pageId: page.id,
            keepLatest: count,
            token: preview.token
          });

        setMode(undefined);
        onClosed?.();
      },
      catch: toStudyError
    })
  );

  function open(next: 'history' | 'deletion') {
    retire.reset();
    setMode(next);
  }

  return {
    page,
    mode,
    setMode,
    keepLatest,
    setKeepLatest,
    preview,
    inspect,
    retire,
    validKeep,
    open
  };
}
