import type { documentProposalOutcomeSchema } from '@study/contracts/materials/editing';
import { Button } from '@study/ui/button';
import { DocumentEditing } from '@study/ui/document-editing';
import { ErrorState } from '@study/ui/error-state';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { useI18n } from '../../lib/i18n';
import { versionOptions } from '../../lib/study-client/materials.queries';
import { ComparisonView } from './document-actions';
import { useProposalReview } from './proposal-review.queries';

type Outcome = typeof documentProposalOutcomeSchema.Type;

/** Session result cards supply their committed request identity. */
type ProposalView = ReturnType<typeof useProposalReview>;

export function ProposalReview({ requestId }: { requestId: string }) {
  const view = useProposalReview({ requestId });
  const { t, comparison, outcome, busy, failed, attempt, run } = view;

  return (
    <DocumentEditing.Proposal>
      <h3>{t('DocumentProposal')}</h3>
      <ProposalActions view={view} />
      {comparison.isError && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={t('DocumentActionFailed')}
          action={<Button onClick={() => void comparison.refetch()}>{t('LibraryRefresh')}</Button>}
        />
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
    </DocumentEditing.Proposal>
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
    <ErrorState title={t('ErrorStateTitle')} description={t('SessionContextUnavailable')} />
  ) : null;
}

function ProposalActions({ view }: { view: ProposalView }) {
  const { t, comparison, busy, attempt, outcome, act } = view;

  return (
    <>
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
    </>
  );
}
