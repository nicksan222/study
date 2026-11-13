import type { NoteId } from '@study/contracts/ids';
import { toastManager } from '@study/ui/toast';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { request } from '#client/lib/study-client/request.ts';

import { executionOptions, noteKey, noteOptions } from './note-workspace.queries';

export function useNoteTitle(id: NoteId) {
  const cache = useQueryClient();

  return useMutation({
    mutationKey: ['note-workspace', String(id), 'rename'],
    mutationFn: (title: string) => request((client) => client['notes.renameNote']({ id, title })),
    onSuccess: (note) => {
      cache.setQueryData(noteOptions(id).queryKey, note);
      void cache.invalidateQueries({ queryKey: ['notes'] });
      void cache.invalidateQueries({ queryKey: ['search'] });
    }
  });
}

/** Tracks an explicit title request through durable completion before refreshing navigation. */
export function useRegenerateNoteTitle(id: NoteId) {
  const readiness = useAiReadiness('tiny');
  const cache = useQueryClient();
  const { t } = useI18n();
  const [requestId, setRequestId] = useState<string>();
  const handled = useRef<string | undefined>(undefined);
  const mutationKey = [...noteKey(id), 'regenerate-title'];
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
    void cache.invalidateQueries({ queryKey: noteKey(id) });
    void cache.invalidateQueries({ queryKey: ['notes'] });
    void cache.invalidateQueries({ queryKey: ['search'] });

    if (completed.outcome === 'failure') {
      toastManager.add({
        title: t('NoteActionErrorTitle'),
        description: t('TitleGenerationError'),
        type: 'error'
      });
    }
  }, [cache, completed, id, requestId, t]);

  const mutation = useMutation({
    mutationKey,
    retry: false,
    mutationFn: () => request((client) => client['notes.requestTitle']({ noteId: id })),
    onSuccess: (result) => {
      setRequestId(result.requestId);
    },
    onError: () => {
      toastManager.add({
        title: t('NoteActionErrorTitle'),
        description: t('TitleGenerationError'),
        type: 'error'
      });
    }
  });
  const pending = submitting || (requestId !== undefined && !completed);

  return {
    pending,
    readiness,
    regenerate: () => {
      if (readiness !== 'ready' || pending || cache.isMutating({ mutationKey, exact: true }))
        return;

      mutation.mutate();
    }
  };
}
