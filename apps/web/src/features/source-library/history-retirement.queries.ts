import { StudyError } from '@study/contracts/errors';
import type { SourceId } from '@study/contracts/ids';
import type {
  sourceHistoryPreviewSchema,
  sourceHistoryRetireSchema
} from '@study/contracts/sources/rpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '#web/lib/study-client/request.ts';

import { releaseBodyPreviews } from '../document-presentation/body-cache';

type Preview = typeof sourceHistoryPreviewSchema.Type;
type Input = typeof sourceHistoryRetireSchema.Type;
type State = { attempt?: Preview; notice?: 'removed' | 'reconciled' };
export function useSourceHistoryRetirement(sourceId: SourceId, onRetired: () => void) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState('1');
  const stateKey = ['sources', 'history-retirement', String(sourceId)];
  const initial: State = {};
  const state = useQuery({
    queryKey: stateKey,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const keepLatest = Number(keep);
  const valid = Number.isInteger(keepLatest) && keepLatest >= 1 && keepLatest <= 100;
  const preview = useQuery({
    queryKey: ['sources', 'history-preview', String(sourceId), keep],
    enabled: open && valid,
    retry: false,
    queryFn: ({ signal }) =>
      request((rpc) => rpc['sources.previewHistory']({ sourceId, keepLatest }), signal)
  });
  async function finish(value: Preview, notice: 'removed' | 'reconciled') {
    await releaseBodyPreviews(cache, {
      kind: 'source',
      sourceId: String(sourceId),
      snapshotIds: value.candidates.map((item) => String(item.snapshotId))
    });
    onRetired();
    setOpen(false);
    cache.setQueryData<State>(stateKey, { notice });
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['sources', 'history', String(sourceId)] }),
      cache.invalidateQueries({ queryKey: ['sources', 'history-preview', String(sourceId)] })
    ]);
  }
  const remove = useMutation({
    mutationKey: ['sources', 'retire-history', String(sourceId)],
    mutationFn: (input: Input) => request((rpc) => rpc['sources.retireHistory'](input)),
    onSuccess: (value) => finish(value, 'removed'),
    onError: async () => {
      const attempt = cache.getQueryData<State>(stateKey)?.attempt;
      if (attempt)
        await releaseBodyPreviews(cache, {
          kind: 'source',
          sourceId: String(sourceId),
          snapshotIds: attempt.candidates.map((item) => String(item.snapshotId))
        });
    }
  });
  const recover = useMutation({
    mutationFn: async () => {
      const attempt = cache.getQueryData<State>(stateKey)?.attempt;
      if (!attempt) throw new StudyError('invalid_input', 'No source history removal to reconcile');
      const current = await request((rpc) =>
        rpc['sources.previewHistory']({ sourceId, keepLatest: attempt.keepLatest })
      );
      const retained = new Set(current.candidates.map((item) => String(item.snapshotId)));
      // Each reviewed batch contains the oldest one hundred candidates. Any surviving reviewed
      // identity is still in that oldest batch; concurrent publications only append newer identities.
      if (attempt.candidates.some((item) => retained.has(String(item.snapshotId))))
        throw new StudyError('invalid_input', 'Reviewed source history removal is not confirmed');
      return attempt;
    },
    onSuccess: (value) => finish(value, 'reconciled')
  });
  function show() {
    remove.reset();
    recover.reset();
    const prior = cache.getQueryData<State>(stateKey);
    if (prior?.attempt) setKeep(String(prior.attempt.keepLatest));
    cache.setQueryData<State>(stateKey, { attempt: prior?.attempt });
    setOpen(true);
  }
  function confirm() {
    const value = preview.data;
    if (
      cache.getQueryData<State>(stateKey)?.attempt ||
      !value ||
      preview.isFetching ||
      preview.isError ||
      !valid ||
      value.blockedSnapshotIds.length ||
      !value.candidates.length
    )
      return;
    cache.setQueryData<State>(stateKey, { attempt: value });
    remove.mutate({ sourceId, keepLatest: value.keepLatest, token: value.token });
  }
  function reviewAgain() {
    cache.setQueryData<State>(stateKey, {});
    remove.reset();
    recover.reset();
    void preview.refetch();
  }
  return {
    open,
    setOpen,
    show,
    keep,
    setKeep,
    valid,
    preview,
    confirm,
    reviewAgain,
    remove,
    recover,
    state: state.data,
    pending: remove.isPending || recover.isPending
  };
}
