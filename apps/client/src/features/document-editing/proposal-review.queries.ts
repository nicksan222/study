import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type {
  applyProposalSchema,
  keepProposalSchema,
  comparisonSchema,
  proposalOutcomeSchema
} from '@study/contracts/pages/editing';
import { rpc } from '@study/contracts/react';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

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

const proposals = Atom.family((_requestId: string) => Atom.make(initial).pipe(Atom.keepAlive));

export function useProposalReview({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const registry = useContext(RegistryContext);
  const atom = proposals(requestId);
  const comparison = rpc.pages.compareProposal.useQuery({ requestId });
  const { outcome, pending: busy, failed, attempt } = useAtomValue(atom);
  const update = (patch: Partial<ProposalState>) =>
    registry.set(atom, { ...registry.get(atom), ...patch });

  async function run(input: Attempt) {
    const owned = registry.get(atom);

    if (receiptBlocked(owned, input)) return;

    update({ attempt: input, pending: true, failed: false });

    try {
      const receipt = await (input.kind === 'apply'
        ? rpc.pages.applyProposal.call(input.input)
        : rpc.pages.keepProposal.call(input.input));

      // Retain the exact receipt before refreshing or navigating away.
      update({ outcome: receipt, attempt: undefined });
    } catch {
      update({ failed: true });
    } finally {
      update({ pending: false });
    }
  }

  function act(kind: 'apply' | 'keep', value: typeof comparisonSchema.Type) {
    const owned = registry.get(atom);

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

function receiptBlocked(owned: ProposalState, input: Attempt) {
  if (owned.pending) return true;

  if (owned.outcome && owned.outcome.outcome !== 'conflict') return true;

  return owned.attempt !== undefined && owned.attempt.input.key !== input.input.key;
}
