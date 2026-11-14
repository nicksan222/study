import { RegistryContext, useAtom } from '@effect/atom-react';
import { StudyError } from '@study/contracts/errors';
import type { SourceId, ContentSnapshotId } from '@study/contracts/ids';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import type {
  sourceHistoryPreviewSchema,
  sourceHistoryRetireSchema
} from '@study/contracts/sources/rpc';
import { Effect } from 'effect';
import { Atom } from 'effect/reactivity';
import { useContext, useState } from 'react';

import { toStudyError } from '#client/lib/study-client/errors.ts';

type Preview = typeof sourceHistoryPreviewSchema.Type;

type Input = typeof sourceHistoryRetireSchema.Type;

type State = { attempt?: Preview; notice?: 'removed' | 'reconciled' };

const attempts = Atom.family((_key: string) => Atom.make<State>({}).pipe(Atom.keepAlive));

export function useSourceHistoryRetirement(
  sourceId: SourceId,
  onRetired: () => void,
  snapshotId?: ContentSnapshotId | null
) {
  const atom = attempts(`${sourceId}:${snapshotId === null ? 'selection' : (snapshotId ?? '')}`);
  const registry = useContext(RegistryContext);
  const [state, setState] = useAtom(atom);
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState('1');
  const exact = snapshotId == null ? {} : { snapshotId };
  const keepLatest = Number(keep);
  const valid = Number.isInteger(keepLatest) && keepLatest >= 1 && keepLatest <= 100;
  const preview = rpc.sources.previewHistory.useQuery(
    { sourceId, keepLatest, ...exact },
    { enabled: open && valid && snapshotId !== null }
  );

  function finish(notice: 'removed' | 'reconciled') {
    onRetired();
    setOpen(false);
    setState({ notice });
  }

  const remove = useIndependentMutation((input: Input) =>
    Effect.tryPromise({
      try: async () => {
        const result = await rpc.sources.retireHistory.call(input);

        finish('removed');

        return result;
      },
      catch: toStudyError
    })
  );
  const recover = useIndependentMutation((_input: void) =>
    Effect.tryPromise({
      try: async () => {
        const attempt = registry.get(atom).attempt;

        if (!attempt)
          throw new StudyError('invalid_input', 'No source history removal to reconcile');

        const current = await rpc.sources.previewHistory.read({
          sourceId,
          keepLatest: attempt.keepLatest,
          ...(attempt.snapshotId === undefined ? {} : { snapshotId: attempt.snapshotId })
        });
        const retained = new Set(current.candidates.map((item) => String(item.snapshotId)));

        if (attempt.candidates.some((item) => retained.has(String(item.snapshotId))))
          throw new StudyError('invalid_input', 'Reviewed source history removal is not confirmed');

        finish('reconciled');

        return attempt;
      },
      catch: toStudyError
    })
  );

  function show() {
    remove.reset();
    recover.reset();
    const prior = registry.get(atom);

    if (prior.attempt) setKeep(String(prior.attempt.keepLatest));

    setState({ attempt: prior.attempt });
    setOpen(true);
  }

  function confirm() {
    const value = preview.data;

    if (
      registry.get(atom).attempt ||
      !value ||
      preview.isFetching ||
      preview.isError ||
      !valid ||
      value.blockedSnapshotIds.length ||
      !value.candidates.length
    )
      return;

    setState({ attempt: value });
    void remove.mutate({ sourceId, keepLatest: value.keepLatest, token: value.token, ...exact });
  }

  function reviewAgain() {
    setState({});
    remove.reset();
    recover.reset();
    preview.retry();
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
    state,
    pending: remove.isPending || recover.isPending
  };
}
