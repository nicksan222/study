import type { MaterialId } from '@study/contracts/ids';
import type {
  materialDeletionPreviewSchema,
  materialDeletionSchema
} from '@study/contracts/materials/deletion';
import type {
  historyPreviewSchema,
  historyPruneSchema,
  requestHistoryPruneSchema
} from '@study/contracts/materials/history';
import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from '@study/ui/dialog';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { request } from '../../lib/study-client/request';

type DeletePreview = typeof materialDeletionPreviewSchema.Type;
type DeleteOperation = typeof materialDeletionSchema.Type;
type PrunePreview = typeof historyPreviewSchema.Type;
type PruneOperation = typeof historyPruneSchema.Type;
export function MaterialLifecycle({ id }: { id: MaterialId }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [mode, setMode] = useState<'delete' | 'prune'>();
  const [deletion, setDeletion] = useState<DeletePreview>();
  const [prune, setPrune] = useState<PrunePreview>();
  const [deleteOperation, setDeleteOperation] = useState<DeleteOperation>();
  client.setQueryDefaults(['material-prune-intent'], { gcTime: Infinity });
  const pruneKey = ['material-prune-intent', String(id)];
  const [pruneOperation, setPruneOperationState] = useState<PruneOperation | undefined>(() =>
    client.getQueryData([...pruneKey, 'receipt'])
  );
  const [pruneInput, setPruneInput] = useState<typeof requestHistoryPruneSchema.Type | undefined>(
    () => client.getQueryData([...pruneKey, 'input'])
  );
  function setPruneOperation(value: PruneOperation | undefined) {
    setPruneOperationState(value);
    if (value) client.setQueryData([...pruneKey, 'receipt'], value);
    else client.removeQueries({ queryKey: [...pruneKey, 'receipt'], exact: true });
  }
  const [keep, setKeep] = useState('10');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const operationId = useRef(crypto.randomUUID());
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await action();
      await client.invalidateQueries({ queryKey: ['materials'] });
    } catch {
      setFailed(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function preview() {
    return run(async () => {
      setDeletion(undefined);
      setPrune(undefined);
      if (mode === 'delete')
        setDeletion(await request((rpc) => rpc['materials.previewDeletion']({ materialId: id })));
      else {
        operationId.current = crypto.randomUUID();
        setPrune(
          await request((rpc) =>
            rpc['materials.previewHistoryPrune']({
              materialId: id,
              policy: { keepLatest: Number(keep) }
            })
          )
        );
      }
    });
  }
  const operation = mode === 'delete' ? deleteOperation : pruneOperation;
  return (
    <section className="reader-history">
      <div className="material-actions">
        <Button variant="ghost" onClick={() => setMode('prune')}>
          {t('DocumentPrune')}
        </Button>
        <Button variant="ghost" onClick={() => setMode('delete')}>
          {t('DocumentDelete')}
        </Button>
      </div>
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
          <div className="library-import">
            <p>{t(mode === 'delete' ? 'DocumentDeleteExplanation' : 'DocumentPruneExplanation')}</p>
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
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setDeleteOperation(
                        await request((rpc) =>
                          rpc['materials.requestDeletion']({
                            materialId: id,
                            token: deletion.token,
                            descendantIds: []
                          })
                        )
                      );
                    })
                  }
                >
                  {t('DocumentConfirmDelete')}
                </Button>
              </>
            )}
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
                <Button
                  disabled={busy || prune.candidateIds.length === 0}
                  onClick={() =>
                    void run(async () => {
                      const input = pruneInput ?? {
                        materialId: id,
                        policy: prune.policy,
                        token: prune.token,
                        candidateIds: prune.candidateIds,
                        operationId: operationId.current
                      };
                      setPruneInput(input);
                      client.setQueryData([...pruneKey, 'input'], input);
                      setPruneOperation(
                        await request((rpc) => rpc['materials.requestHistoryPrune'](input))
                      );
                    })
                  }
                >
                  {t('DocumentConfirmPrune')}
                </Button>
              </>
            )}
            {mode === 'prune' && pruneInput && !pruneOperation && !prune && (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setPruneOperation(
                      await request((rpc) => rpc['materials.requestHistoryPrune'](pruneInput))
                    );
                  })
                }
              >
                {t('DocumentRetryCleanup')}
              </Button>
            )}
            {operation && (
              <>
                <p role="status">
                  {t(
                    operation.status === 'completed'
                      ? 'DocumentCleanupCompleted'
                      : operation.status === 'failed'
                        ? 'DocumentCleanupFailed'
                        : 'DocumentCleanupPending'
                  )}
                </p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (mode === 'delete')
                        setDeleteOperation(
                          await request((rpc) => rpc['materials.deletion']({ materialId: id }))
                        );
                      else if (pruneOperation)
                        setPruneOperation(
                          await request((rpc) =>
                            rpc['materials.historyPrune']({
                              operationId: pruneOperation.operationId
                            })
                          )
                        );
                    })
                  }
                >
                  {t('LibraryRefresh')}
                </Button>
                {operation.status === 'failed' && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (mode === 'delete')
                          setDeleteOperation(
                            await request((rpc) =>
                              rpc['materials.retryDeletion']({ materialId: id })
                            )
                          );
                        else if (pruneOperation)
                          setPruneOperation(
                            await request((rpc) =>
                              rpc['materials.retryHistoryPrune']({
                                operationId: pruneOperation.operationId
                              })
                            )
                          );
                      })
                    }
                  >
                    {t('DocumentRetryCleanup')}
                  </Button>
                )}
              </>
            )}
            {mode === 'prune' && pruneOperation?.status === 'completed' && (
              <Button
                disabled={busy}
                onClick={() => {
                  setPruneOperation(undefined);
                  setPruneInput(undefined);
                  client.removeQueries({ queryKey: pruneKey });
                  setPrune(undefined);
                  operationId.current = crypto.randomUUID();
                  setFailed(false);
                }}
              >
                {t('DocumentPruneNext')}
              </Button>
            )}
            {failed && (
              <ErrorState
                title={t('ErrorStateTitle')}
                description={<> {t('DocumentPreviewFailed')} </>}
              />
            )}
            <Button variant="ghost" disabled={busy} onClick={() => setMode(undefined)}>
              {t('Close')}
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
    </section>
  );
}

/** Recovery uses the durable deletion identity even after content reads are fenced. */
export function DeletionRecovery({ id }: { id: MaterialId }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ['material-deletion', String(id)],
    queryFn: ({ signal }) =>
      request((rpc) => rpc['materials.deletion']({ materialId: id }), signal),
    retry: false
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  if (state.isError && toStudyError(state.error).kind === 'not_found') return null;
  return (
    <section className="reader-notice" aria-label={t('DocumentDelete')}>
      <p role="status">
        {t(
          state.data
            ? state.data.status === 'completed'
              ? 'DocumentCleanupCompleted'
              : state.data.status === 'failed'
                ? 'DocumentCleanupFailed'
                : 'DocumentCleanupPending'
            : state.isPending
              ? 'LoadingStudy'
              : 'DocumentPreviewFailed'
        )}
      </p>
      <Button disabled={busy || state.isFetching} onClick={() => void state.refetch()}>
        {t('LibraryRefresh')}
      </Button>
      {state.data?.status === 'failed' && (
        <Button
          disabled={busy}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setFailed(false);
            try {
              const result = await request((rpc) =>
                rpc['materials.retryDeletion']({ materialId: id })
              );
              client.setQueryData(['material-deletion', String(id)], result);
            } catch {
              setFailed(true);
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          {t('DocumentRetryCleanup')}
        </Button>
      )}
      {failed && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={<> {t('DocumentPreviewFailed')} </>}
        />
      )}
    </section>
  );
}
