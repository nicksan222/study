import type { MaterialId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from '@study/ui/dialog';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { MaterialLibrary } from '@study/ui/material-library';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { useMaterialLifecycle, useDeletionRecovery } from './material-lifecycle.queries';

function cleanupMessage(status: 'pending' | 'running' | 'failed' | 'completed') {
  if (status === 'completed') return 'DocumentCleanupCompleted';

  return status === 'failed' ? 'DocumentCleanupFailed' : 'DocumentCleanupPending';
}

type LifecycleController = ReturnType<typeof useMaterialLifecycle>;

function PruneSettings({ c }: { c: LifecycleController }) {
  const { t } = useI18n();
  const { mode, pruneOperation, pruneInput, keep, busy, setKeep, setPrune } = c;

  return (
    <>
      {mode === 'prune' && !pruneOperation && !pruneInput && (
        <label>
          {t('DocumentKeepLatest')}
          <Input
            type="number"
            min={1}
            max={1000}
            value={keep}
            disabled={busy}
            onValueChange={(value) => {
              setKeep(value);
              setPrune(undefined);
            }}
          />
        </label>
      )}
    </>
  );
}

function LifecyclePreview({ c }: { c: LifecycleController }) {
  const { t } = useI18n();
  const { operation, mode, pruneInput, busy, keep, preview } = c;

  return (
    <>
      {!operation && !(mode === 'prune' && pruneInput) && (
        <Button
          disabled={
            busy ||
            (mode === 'prune' &&
              (!Number.isInteger(Number(keep)) || Number(keep) < 1 || Number(keep) > 1000))
          }
          onClick={() => void preview()}
        >
          {t('DocumentPreview')}
        </Button>
      )}
    </>
  );
}

function DeletionPreview({ c }: { c: LifecycleController }) {
  const { t } = useI18n();
  const { deletion, mode, operation, busy } = c;

  return (
    <>
      {deletion && mode === 'delete' && !operation && (
        <>
          <p>{t('DocumentDeleteImpact')}</p>
          <ul>
            {deletion.versionIds.map((version) => (
              <li key={String(version)}>
                {t('ReaderVersion')} {String(version)}
              </li>
            ))}
          </ul>
          <p>{t('DocumentRetainedCopies')}</p>
          <p>
            {t('DocumentDependentReferences')} {deletion.references.length} ·{' '}
            {t('DocumentRetainedCitations')} {deletion.retainedMessageCitationCount}
          </p>
          <Button disabled={busy} onClick={c.confirmDeletion}>
            {t('DocumentConfirmDelete')}
          </Button>
        </>
      )}
    </>
  );
}

function PrunePreview({ c }: { c: LifecycleController }) {
  const { t } = useI18n();
  const { prune, mode, operation, busy } = c;

  return (
    <>
      {prune && mode === 'prune' && !operation && (
        <>
          <p>{t('DocumentPruneImpact')}</p>
          <ul>
            {prune.candidateIds.map((version) => (
              <li key={String(version)}>
                {t('ReaderVersion')} {String(version)}
              </li>
            ))}
          </ul>
          <p>
            {t('DocumentRetainedCitations')} {prune.retainedMessageCitationCount} ·{' '}
            {t('DocumentDependentReferences')} {prune.references.length}
          </p>
          <p>
            {t('DocumentProtectedVersions')} {prune.protected.length}
          </p>
          {prune.hasMore && <p>{t('DocumentPruneMore')}</p>}
          <Button disabled={busy || prune.candidateIds.length === 0} onClick={c.confirmPrune}>
            {t('DocumentConfirmPrune')}
          </Button>
        </>
      )}
    </>
  );
}

function PruneRetry({ c }: { c: LifecycleController }) {
  const { t } = useI18n();
  const { mode, pruneInput, pruneOperation, prune, busy } = c;

  return (
    <>
      {mode === 'prune' && pruneInput && !pruneOperation && !prune && (
        <Button disabled={busy} onClick={c.retryPruneInput}>
          {t('DocumentRetryCleanup')}
        </Button>
      )}
    </>
  );
}

function CleanupOperation({ c }: { c: LifecycleController }) {
  const { t } = useI18n();
  const { operation, busy } = c;

  return (
    <>
      {operation && (
        <>
          <p role="status">{t(cleanupMessage(operation.status))}</p>
          <Button disabled={busy} onClick={c.refreshOperation}>
            {t('LibraryRefresh')}
          </Button>
          {operation.status === 'failed' && (
            <ErrorState
              title={t('ErrorStateTitle')}
              description={
                <>
                  <Button disabled={busy} onClick={c.retryOperation}>
                    {t('DocumentRetryCleanup')}
                  </Button>
                </>
              }
            />
          )}
        </>
      )}
    </>
  );
}

function PruneNext({ c }: { c: LifecycleController }) {
  const { t } = useI18n();
  const { mode, pruneOperation, busy } = c;

  return (
    <>
      {mode === 'prune' && pruneOperation?.status === 'completed' && (
        <Button disabled={busy} onClick={c.nextPrune}>
          {t('DocumentPruneNext')}
        </Button>
      )}
    </>
  );
}

export function MaterialLifecycle({ id }: { id: MaterialId }) {
  const { t } = useI18n();
  const c = useMaterialLifecycle(id);
  const { mode, setMode, busy, failed } = c;

  return (
    <MaterialLibrary.HistorySection>
      <MaterialLibrary.Actions>
        <Button variant="ghost" onClick={() => setMode('prune')}>
          {t('DocumentPrune')}
        </Button>
        <Button variant="ghost" onClick={() => setMode('delete')}>
          {t('DocumentDelete')}
        </Button>
      </MaterialLibrary.Actions>
      <Dialog
        open={!!mode}
        onOpenChange={(open) => {
          if (!open && !busy) setMode(undefined);
        }}
      >
        <DialogPopup closeLabel={t('Close')}>
          <DialogHeader>
            <DialogTitle>{t(mode === 'delete' ? 'DocumentDelete' : 'DocumentPrune')}</DialogTitle>
          </DialogHeader>
          <MaterialLibrary.Import>
            <p>{t(mode === 'delete' ? 'DocumentDeleteExplanation' : 'DocumentPruneExplanation')}</p>
            <PruneSettings c={c} />
            <LifecyclePreview c={c} />
            <DeletionPreview c={c} />
            <PrunePreview c={c} />
            <PruneRetry c={c} />
            <CleanupOperation c={c} />
            <PruneNext c={c} />
            {failed && (
              <ErrorState
                title={t('ErrorStateTitle')}
                description={<> {t('DocumentPreviewFailed')} </>}
              />
            )}
            <Button variant="ghost" disabled={busy} onClick={() => setMode(undefined)}>
              {t('Close')}
            </Button>
          </MaterialLibrary.Import>
        </DialogPopup>
      </Dialog>
    </MaterialLibrary.HistorySection>
  );
}

function RecoveryStatus({ state }: { state: ReturnType<typeof useDeletionRecovery>['state'] }) {
  const { t } = useI18n();

  if (state.data) return <p role="status">{t(cleanupMessage(state.data.status))}</p>;

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  return <ErrorState title={t('ErrorStateTitle')} description={t('DocumentPreviewFailed')} />;
}

/** Recovery uses the durable deletion identity even after content reads are fenced. */
export function DeletionRecovery({ id }: { id: MaterialId }) {
  const { t } = useI18n();
  const { state, busy, failed, retry } = useDeletionRecovery(id);

  if (state.isError && toStudyError(state.error).kind === 'not_found') return null;

  return (
    <MaterialLibrary.Notice aria-label={t('DocumentDelete')}>
      <RecoveryStatus state={state} />

      <Button disabled={busy || state.isFetching} onClick={() => void state.refetch()}>
        {t('LibraryRefresh')}
      </Button>
      {state.data?.status === 'failed' && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              <Button disabled={busy} onClick={retry}>
                {t('DocumentRetryCleanup')}
              </Button>
            </>
          }
        />
      )}
      {failed && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={<> {t('DocumentPreviewFailed')} </>}
        />
      )}
    </MaterialLibrary.Notice>
  );
}
