import type { proposalOutcomeSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button, DocumentEditing, ErrorState, StatusMessage } from '@study/ui';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#client/lib/i18n.tsx';

import { ComparisonView } from './page-actions';
import { useProposalReview } from './proposal-review.queries';

type Outcome = typeof proposalOutcomeSchema.Type;

/** Note result cards supply their committed request identity. */
type ProposalView = ReturnType<typeof useProposalReview>;

export function ProposalReview({
  requestId,
  dismiss,
  disabled = false
}: {
  requestId: string;
  dismiss?: () => void;
  disabled?: boolean;
}) {
  const view = useProposalReview({ requestId });
  const { t, comparison, outcome, busy, failed, attempt, run } = view;

  return (
    <DocumentEditing.Proposal>
      <h3>{t('PageProposal')}</h3>
      <ProposalActions view={view} dismiss={dismiss} disabled={disabled} />
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
  const version = rpc.pages.version.useQuery({ id: versionId });

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

function ProposalActions({
  view,
  dismiss,
  disabled
}: {
  view: ProposalView;
  dismiss?: () => void;
  disabled: boolean;
}) {
  const { t, comparison, busy, attempt, outcome, act } = view;
  const value = comparison.data;

  if (!comparison.isSuccess || !value) return null;

  return (
    <>
      <ComparisonView value={value} expandProposal={!!dismiss} />
      <Button
        disabled={disabled || busy || !!attempt || !!outcome}
        onClick={() => void act('apply', value)}
      >
        {t('PageApply')}
      </Button>
      {dismiss ? (
        <Button variant="ghost" disabled={busy || !!attempt} onClick={dismiss}>
          {t(outcome?.outcome === 'applied' ? 'Close' : 'DocumentDismiss')}
        </Button>
      ) : (
        <KeepProposal view={view} value={value} />
      )}
    </>
  );
}

function KeepProposal({
  view,
  value
}: {
  view: ProposalView;
  value: NonNullable<ProposalView['comparison']['data']>;
}) {
  const { t, busy, attempt, outcome, act } = view;

  return (
    <Button
      variant="ghost"
      disabled={busy || !!attempt || (!!outcome && outcome.outcome !== 'conflict')}
      onClick={() => void act('keep', value)}
    >
      {t('PageKeepNew')}
    </Button>
  );
}
