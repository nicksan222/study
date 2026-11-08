import type {
  applyProposalSchema,
  keepProposalSchema,
  comparisonSchema,
  proposalOutcomeSchema
} from '@study/contracts/pages/editing';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useI18n } from '#web/lib/i18n.tsx';
import { invalidatePages } from '#web/lib/study-client/pages.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

type Outcome = typeof proposalOutcomeSchema.Type;

type Attempt =
  | { kind: 'apply'; input: typeof applyProposalSchema.Type }
  | { kind: 'keep'; input: typeof keepProposalSchema.Type };

type ProposalState = { pending: boolean; failed: boolean; attempt?: Attempt; outcome?: Outcome };

function proposalActionBlocked(kind: 'apply' | 'keep', owned: ProposalState | undefined) {
  return (
    owned?.pending ||
    owned?.attempt ||
    (owned?.outcome && (kind === 'apply' || owned.outcome.outcome !== 'conflict'))
  );
}

const initial: ProposalState = { pending: false, failed: false };

export function useProposalReview({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const comparison = useQuery({
    queryKey: ['pages', 'proposal-comparison', requestId],
    queryFn: () => request((rpc) => rpc['pages.compareProposal']({ requestId }))
  });
  const key = ['document-proposal-actions', requestId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const { outcome, pending: busy, failed, attempt } = state.data;
  const update = (patch: Partial<ProposalState>) =>
    client.setQueryData<ProposalState>(key, (old) => ({ ...(old ?? initial), ...patch }));

  async function run(input: Attempt) {
    const owned = client.getQueryData<ProposalState>(key);

    if (owned?.pending || (owned?.outcome && owned.outcome.outcome !== 'conflict')) return;

    if (owned?.attempt && owned.attempt.input.key !== input.input.key) return;

    update({ attempt: input, pending: true, failed: false });

    try {
      const receipt = await request((rpc) =>
        input.kind === 'apply'
          ? rpc['pages.applyProposal'](input.input)
          : rpc['pages.keepProposal'](input.input)
      );

      // Retain the exact receipt before refreshing or navigating away.
      update({ outcome: receipt, attempt: undefined });
      await invalidatePages(client);
    } catch {
      update({ failed: true });
    } finally {
      update({ pending: false });
    }
  }

  function act(kind: 'apply' | 'keep', value: typeof comparisonSchema.Type) {
    const owned = client.getQueryData<ProposalState>(key);

    if (!comparison.isSuccess || proposalActionBlocked(kind, owned)) return;

    const operationKey = crypto.randomUUID();

    void run(
      kind === 'apply'
        ? {
            kind,
            input: {
              requestId,
              key: operationKey,
              expectedVersionId: value.beforeVersionId
            }
          }
        : { kind, input: { requestId, key: operationKey, title: t('PageCopyTitle') } }
    );
  }

  return { t, comparison, outcome, busy, failed, attempt, run, act };
}
