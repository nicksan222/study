import type { NoteId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { toastManager } from '@study/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import { useI18n } from '#client/lib/i18n.tsx';

export function useNoteTitle(id: NoteId) {
  const mutation = rpc.notes.rename.useMutation();

  return {
    ...mutation,
    mutate: (title: string) => mutation.mutate({ id, title }),
    mutateAsync: (title: string) => mutation.mutateAsync({ id, title })
  };
}

/** Observes durable completion; committed server revisions update the title everywhere. */
export function useRegenerateNoteTitle(id: NoteId) {
  const readiness = useAiReadiness('tiny');
  const { t } = useI18n();
  const [requestId, setRequestId] = useState<string>();
  const handled = useRef<string | undefined>(undefined);
  const mutation = rpc.notes.requestTitle.useMutation();
  const execution = rpc.workflows.executions.useQuery(
    { correlationId: requestId ?? '', limit: 30 },
    { enabled: requestId !== undefined }
  );
  const completed = execution.data?.items.find(
    (item) => item.status === 'completed' || item.status === 'cancelled'
  );
  const report = useCallback(
    () =>
      toastManager.add({
        title: t('NoteActionErrorTitle'),
        description: t('TitleGenerationError'),
        type: 'error'
      }),
    [t]
  );

  useEffect(() => {
    if (!requestId || !completed || handled.current === requestId) return;

    handled.current = requestId;

    if (completed.outcome === 'failure') report();
  }, [completed, requestId, report]);
  const pending = mutation.isPending || (requestId !== undefined && !completed);

  return {
    pending,
    readiness,
    regenerate: () => {
      if (readiness !== 'ready' || pending) return;

      void mutation.mutate({ noteId: id }).then((value) => setRequestId(value.requestId), report);
    }
  };
}
