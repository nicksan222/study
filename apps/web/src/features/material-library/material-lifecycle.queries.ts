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
import { toastManager } from '@study/ui/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import type { StudyClient } from '../../lib/study-client/client';
import { request } from '../../lib/study-client/request';

type DeletePreview = typeof materialDeletionPreviewSchema.Type;

type DeleteOperation = typeof materialDeletionSchema.Type;

type PrunePreview = typeof historyPreviewSchema.Type;

type PruneOperation = typeof historyPruneSchema.Type;

type Confirmation =
  | { kind: 'delete'; input: Parameters<StudyClient['materials.requestDeletion']>[0] }
  | { kind: 'prune'; input: typeof requestHistoryPruneSchema.Type };

export function useMaterialLifecycle(id: MaterialId) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState<Confirmation>();
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

  function confirmDeletion() {
    if (deletion)
      setConfirmation({
        kind: 'delete',
        input: { materialId: id, token: deletion.token, descendantIds: [] }
      });
  }

  function confirmPrune() {
    if (prune)
      setConfirmation({
        kind: 'prune',
        input: pruneInput ?? {
          materialId: id,
          policy: prune.policy,
          token: prune.token,
          candidateIds: prune.candidateIds,
          operationId: operationId.current
        }
      });
  }

  function confirmCleanup() {
    const submitted = confirmation;
    if (!submitted || busy) return;
    return run(async () => {
      let result: DeleteOperation | PruneOperation;
      if (submitted.kind === 'delete') {
        result = await request((rpc) => rpc['materials.requestDeletion'](submitted.input));
        setDeleteOperation(result);
      } else {
        setPruneInput(submitted.input);
        client.setQueryData([...pruneKey, 'input'], submitted.input);
        result = await request((rpc) => rpc['materials.requestHistoryPrune'](submitted.input));
        setPruneOperation(result);
      }
      if (result.status === 'failed') {
        toastManager.add({ title: t('DocumentCleanupFailed'), type: 'error' });
        return;
      }
      toastManager.add({
        title: t(
          result.status === 'completed' ? 'DocumentCleanupCompleted' : 'DocumentCleanupPending'
        ),
        type: result.status === 'completed' ? 'success' : 'info'
      });
      setConfirmation(undefined);
    });
  }

  function retryPruneInput() {
    if (!pruneInput) return;

    return run(async () => {
      setPruneOperation(await request((rpc) => rpc['materials.requestHistoryPrune'](pruneInput)));
    });
  }

  function refreshOperation() {
    return run(async () => {
      if (mode === 'delete')
        setDeleteOperation(await request((rpc) => rpc['materials.deletion']({ materialId: id })));
      else if (pruneOperation)
        setPruneOperation(
          await request((rpc) =>
            rpc['materials.historyPrune']({ operationId: pruneOperation.operationId })
          )
        );
    });
  }

  function retryOperation() {
    return run(async () => {
      if (mode === 'delete')
        setDeleteOperation(
          await request((rpc) => rpc['materials.retryDeletion']({ materialId: id }))
        );
      else if (pruneOperation)
        setPruneOperation(
          await request((rpc) =>
            rpc['materials.retryHistoryPrune']({ operationId: pruneOperation.operationId })
          )
        );
    });
  }

  function nextPrune() {
    setPruneOperation(undefined);
    setPruneInput(undefined);
    client.removeQueries({ queryKey: pruneKey });
    setPrune(undefined);
    operationId.current = crypto.randomUUID();
    setFailed(false);
  }

  const operation = mode === 'delete' ? deleteOperation : pruneOperation;

  return {
    confirmation,
    setConfirmation,
    confirmCleanup,
    mode,
    setMode,
    deletion,
    prune,
    pruneOperation,
    pruneInput,
    keep,
    setKeep,
    setPrune,
    busy,
    failed,
    operation,
    preview,
    confirmDeletion,
    confirmPrune,
    retryPruneInput,
    refreshOperation,
    retryOperation,
    nextPrune
  };
}

export function useDeletionRecovery(id: MaterialId) {
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

  async function retry() {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setFailed(false);

    try {
      const result = await request((rpc) => rpc['materials.retryDeletion']({ materialId: id }));

      client.setQueryData(['material-deletion', String(id)], result);
    } catch {
      setFailed(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return { state, busy, failed, retry };
}
