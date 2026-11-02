import { projectIdSchema } from '@study/contracts/ids';
import type { SessionId } from '@study/contracts/ids';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { emptyDraft } from './draft';
import type { Draft } from './draft';
import {
  createSession,
  deleteSession,
  deletionOptions,
  retryDeletion,
  sessionPagesOptions
} from './session-workspace.queries';

export function useSessionStart() {
  const { t, date } = useI18n();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;
  const state = useInfiniteQuery(sessionPagesOptions(project));
  const draftKey = ['session-start-draft', search.project ?? 'all'];
  const draft = useQuery({
    queryKey: draftKey,
    queryFn: () => '',
    initialData: '',
    gcTime: Infinity,
    staleTime: Infinity
  });
  const flow = useQuery({
    queryKey: ['session-workspace', 'creation'],
    queryFn: () => ({}) as { id?: SessionId; uncertain?: boolean; pending?: boolean },
    initialData: {} as { id?: SessionId; uncertain?: boolean; pending?: boolean },
    gcTime: Infinity,
    staleTime: Infinity
  });
  const [navigationError, setNavigationError] = useState<unknown>();
  const [reviewed, setReviewed] = useState(false);

  async function select(id: SessionId) {
    try {
      await navigate({ to: '/sessions', search: { ...search, id: String(id) } });
      setNavigationError(undefined);
    } catch (error) {
      setNavigationError(error);
    }
  }

  const create = useMutation({
    mutationFn: createSession,
    retry: false,
    onMutate: () => {
      cache.setQueryData(['session-workspace', 'creation'], { uncertain: true, pending: true });
      setReviewed(false);
    },
    onError: (error) => {
      if (toStudyError(error).kind === 'invalid_input')
        cache.setQueryData(['session-workspace', 'creation'], {});
    },
    onSettled: () => {
      cache.setQueryData<{ id?: SessionId; uncertain?: boolean; pending?: boolean }>(
        ['session-workspace', 'creation'],
        (previous) => ({ ...previous, pending: false })
      );
    },
    onSuccess: (created) => {
      const text = cache.getQueryData<string>(draftKey) ?? '';

      cache.setQueryData<Draft>(['session-drafts', String(created.id), 'note'], {
        ...emptyDraft,
        text
      });
      cache.setQueryData(draftKey, '');
      cache.setQueryData(['session-workspace', 'creation'], { id: created.id });
      void cache.invalidateQueries({ queryKey: ['sessions'] });
      void select(created.id);
    }
  });

  function beginSession() {
    const current = cache.getQueryData<{ id?: SessionId; uncertain?: boolean; pending?: boolean }>([
      'session-workspace',
      'creation'
    ]);

    if (current?.id || current?.uncertain || current?.pending) return;

    cache.setQueryData(['session-workspace', 'creation'], { uncertain: true, pending: true });
    create.mutate();
  }

  const items = state.data?.pages.flatMap((page) => page.items) ?? [];
  const blocked = create.isPending || !!flow.data.id || !!flow.data.uncertain;

  return {
    t,
    date,
    cache,
    navigate,
    search,
    project,
    state,
    draftKey,
    draft,
    flow,
    navigationError,
    reviewed,
    setReviewed,
    select,
    create,
    beginSession,
    items,
    blocked
  };
}

export function useDeletion({
  id,
  allowDelete,
  onDeleting
}: {
  id: SessionId;
  allowDelete: boolean;
  onDeleting: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [started, setStarted] = useState(false);
  const state = useQuery(deletionOptions(id, true));
  const mutation = useMutation({
    mutationFn: () => deleteSession(id),
    retry: false,
    onMutate: () => {
      setStarted(true);
      onDeleting(true);
    },
    onSuccess: (value) => {
      cache.setQueryData(deletionOptions(id, true).queryKey, value);
      void cache.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (error) => {
      if (toStudyError(error).kind === 'invalid_input') {
        setStarted(false);
        onDeleting(false);
      }

      void cache.invalidateQueries({ queryKey: deletionOptions(id, true).queryKey });
    }
  });
  const retry = useMutation({
    mutationFn: () => retryDeletion(id),
    retry: false,
    onSuccess: (value) => cache.setQueryData(deletionOptions(id, true).queryKey, value)
  });

  return { t, confirm, setConfirm, state, started, mutation, retry, allowDelete };
}
