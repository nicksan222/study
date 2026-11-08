import type { proposalOutcomeSchema } from '@study/contracts/pages/editing';
import { Button } from '@study/ui/button';
import { DocumentEditing } from '@study/ui/document-editing';
import { ErrorState } from '@study/ui/error-state';
import { StatusMessage } from '@study/ui/status-message';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#web/lib/i18n.tsx';
import { pageVersionOptions } from '#web/lib/study-client/pages.queries.ts';

import { ComparisonView } from './page-actions';
import { useProposalReview } from './proposal-review.queries';

type Outcome = typeof proposalOutcomeSchema.Type;

/** Note result cards supply their committed request identity. */
type ProposalView = ReturnType<typeof useProposalReview>;

export function ProposalReview({ requestId }: { requestId: string }) {
  const view = useProposalReview({ requestId });
  const { t, comparison, outcome, busy, failed, attempt, run } = view;

  return (
    <DocumentEditing.Proposal>
      <h3>{t('PageProposal')}</h3>
      <ProposalActions view={view} />
      {comparison.isError && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={t('PageActionFailed')}
          action={<Button onClick={() => void comparison.refetch()}>{t('LibraryRefresh')}</Button>}
        />
      )}
      {outcome && (
        <StatusMessage>
          {t(outcome.outcome === 'conflict' ? 'PageConflict' : 'PageProposalSaved')}
        </StatusMessage>
      )}
      {busy && <StatusMessage>{t('NoteSaving')}</StatusMessage>}
      {outcome?.resultVersionId && <ProposalResult versionId={outcome.resultVersionId} />}
      {failed && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('PageActionFailed')} </>} />
      )}
      {attempt && !busy && (
        <Button variant="outline" onClick={() => void run(attempt)}>
          {t('PageRetryProposal')}
        </Button>
      )}
    </DocumentEditing.Proposal>
  );
}

function ProposalResult({ versionId }: { versionId: NonNullable<Outcome['resultVersionId']> }) {
  const { t } = useI18n();
  const version = useQuery(pageVersionOptions(versionId));

  return version.isSuccess && version.data ? (
    <Link
      to="/pages/$pageId"
      params={{ pageId: String(version.data.pageId) }}
      search={{ pageVersion: String(versionId) }}
    >
      {t('NoteOpenOutput')}
    </Link>
  ) : version.isError ? (
    <ErrorState title={t('ErrorStateTitle')} description={t('NoteContextUnavailable')} />
  ) : null;
}

function ProposalActions({ view }: { view: ProposalView }) {
  const { t, comparison, busy, attempt, outcome, act } = view;

  return (
    <>
      {comparison.isSuccess && (
        <>
          <ComparisonView value={comparison.data} />
          <Button
            disabled={busy || !!attempt || !!outcome}
            onClick={() => void act('apply', comparison.data!)}
          >
            {t('PageApply')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !!attempt || (!!outcome && outcome.outcome !== 'conflict')}
            onClick={() => void act('keep', comparison.data!)}
          >
            {t('PageKeepNew')}
          </Button>
        </>
      )}
    </>
  );
}
