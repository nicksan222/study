import type { SessionId } from '@study/contracts/ids';
import { toastManager } from '@study/ui/toast';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { request } from '#web/lib/study-client/request.ts';

import { executionOptions, sessionKey, sessionOptions } from './session-workspace.queries';

export function useSessionTitle(id: SessionId) {
  const cache = useQueryClient();

  return useMutation({
    mutationKey: ['session-workspace', String(id), 'rename'],
    mutationFn: (title: string) =>
      request((client) => client['conversations.renameSession']({ id, title })),
    onSuccess: (session) => {
      cache.setQueryData(sessionOptions(id).queryKey, session);
      void cache.invalidateQueries({ queryKey: ['sessions'] });
      void cache.invalidateQueries({ queryKey: ['search'] });
    }
  });
}

/** Tracks an explicit title request through durable completion before refreshing navigation. */
export function useRegenerateSessionTitle(id: SessionId) {
  const cache = useQueryClient();
  const { t } = useI18n();
  const [requestId, setRequestId] = useState<string>();
  const handled = useRef<string | undefined>(undefined);
  const mutationKey = [...sessionKey(id), 'regenerate-title'];
  const submitting = useIsMutating({ mutationKey, exact: true }) > 0;
  const execution = useQuery({
    ...executionOptions(requestId ?? ''),
    enabled: requestId !== undefined,
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (item) => item.status === 'completed' || item.status === 'cancelled'
      )
        ? false
        : 3000
  });
  const completed = execution.data?.items.find(
    (item) => item.status === 'completed' || item.status === 'cancelled'
  );

  useEffect(() => {
    if (!requestId || !completed || handled.current === requestId) return;

    handled.current = requestId;
    void cache.invalidateQueries({ queryKey: sessionKey(id) });
    void cache.invalidateQueries({ queryKey: ['sessions'] });
    void cache.invalidateQueries({ queryKey: ['search'] });

    if (completed.outcome === 'failure') {
      toastManager.add({
        title: t('SessionActionErrorTitle'),
        description: t('TitleGenerationError'),
        type: 'error'
      });
    }
  }, [cache, completed, id, requestId, t]);

  const mutation = useMutation({
    mutationKey,
    retry: false,
    mutationFn: () => request((client) => client['conversations.requestTitle']({ sessionId: id })),
    onSuccess: (result) => {
      setRequestId(result.requestId);
    },
    onError: () => {
      toastManager.add({
        title: t('SessionActionErrorTitle'),
        description: t('TitleGenerationError'),
        type: 'error'
      });
    }
  });
  const pending = submitting || (requestId !== undefined && !completed);

  return {
    pending,
    regenerate: () => {
      if (pending || cache.isMutating({ mutationKey, exact: true })) return;

      mutation.mutate();
    }
  };
}
