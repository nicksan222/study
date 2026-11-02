import type {
  applyDocumentProposalSchema,
  keepDocumentProposalSchema,
  documentComparisonSchema,
  documentProposalOutcomeSchema
} from '@study/contracts/materials/editing';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import { versionOptions } from '../material-library/material-library.queries';
import { ComparisonView } from './document-actions';

type Outcome = typeof documentProposalOutcomeSchema.Type;
type Attempt =
  | { kind: 'apply'; input: typeof applyDocumentProposalSchema.Type }
  | { kind: 'keep'; input: typeof keepDocumentProposalSchema.Type };
type ProposalState = { pending: boolean; failed: boolean; attempt?: Attempt; outcome?: Outcome };
const initial: ProposalState = { pending: false, failed: false };

/** Session result cards supply their committed request identity. */
export function ProposalReview({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const comparison = useQuery({
    queryKey: ['materials', 'proposal-comparison', requestId],
    queryFn: () => request((rpc) => rpc['materials.compareDocumentProposal']({ requestId }))
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
          ? rpc['materials.applyDocumentProposal'](input.input)
          : rpc['materials.keepDocumentProposal'](input.input)
      );
      // Retain the exact receipt before refreshing or navigating away.
      update({ outcome: receipt, attempt: undefined });
      await client.invalidateQueries({ queryKey: ['materials'] });
    } catch {
      update({ failed: true });
    } finally {
      update({ pending: false });
    }
  }
  function act(kind: 'apply' | 'keep', value: typeof documentComparisonSchema.Type) {
    const owned = client.getQueryData<ProposalState>(key);
    if (
      owned?.pending ||
      owned?.attempt ||
      (owned?.outcome && (kind === 'apply' || owned.outcome.outcome !== 'conflict'))
    )
      return;
    const operationKey = crypto.randomUUID();
    void run(
      kind === 'apply'
        ? {
            kind,
            input: {
              requestId,
              key: operationKey,
              expectedVersionId: value.currentVersionId,
              baseVersionId: value.beforeVersionId
            }
          }
        : { kind, input: { requestId, key: operationKey } }
    );
  }
  return (
    <section className="reader-history">
      <h3>{t('DocumentProposal')}</h3>
      {comparison.data && (
        <>
          <ComparisonView value={comparison.data} />
          <Button
            disabled={busy || !!attempt || !!outcome}
            onClick={() => void act('apply', comparison.data!)}
          >
            {t('DocumentApply')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !!attempt || (!!outcome && outcome.outcome !== 'conflict')}
            onClick={() => void act('keep', comparison.data!)}
          >
            {t('DocumentKeepNew')}
          </Button>
        </>
      )}
      {comparison.isError && (
        <Button onClick={() => void comparison.refetch()}>{t('LibraryRefresh')}</Button>
      )}
      {outcome && (
        <p role="status">
          {t(outcome.outcome === 'conflict' ? 'DocumentConflict' : 'DocumentProposalSaved')}
        </p>
      )}
      {busy && <p role="status">{t('SessionSaving')}</p>}
      {outcome?.resultVersionId && <ProposalResult versionId={outcome.resultVersionId} />}
      {failed && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('DocumentActionFailed')} </>} />
      )}
      {attempt && !busy && (
        <Button variant="outline" onClick={() => void run(attempt)}>
          {t('DocumentRetryProposal')}
        </Button>
      )}
    </section>
  );
}

function ProposalResult({ versionId }: { versionId: NonNullable<Outcome['resultVersionId']> }) {
  const { t } = useI18n();
  const version = useQuery(versionOptions(versionId));
  return version.data && !version.isError ? (
    <Link
      to="/materials/$materialId"
      params={{ materialId: String(version.data.material_id) }}
      search={{ version: String(versionId) }}
    >
      {t('SessionOpenOutput')}
    </Link>
  ) : version.isError ? (
    <p role="status">{t('SessionContextUnavailable')}</p>
  ) : null;
}
