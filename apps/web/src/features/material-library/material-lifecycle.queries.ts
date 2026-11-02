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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { request } from '../../lib/study-client/request';

type DeletePreview = typeof materialDeletionPreviewSchema.Type;

type DeleteOperation = typeof materialDeletionSchema.Type;

type PrunePreview = typeof historyPreviewSchema.Type;

type PruneOperation = typeof historyPruneSchema.Type;

export function useMaterialLifecycle(id: MaterialId) {
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
    if (!deletion) return;

    return run(async () => {
      setDeleteOperation(
        await request((rpc) =>
          rpc['materials.requestDeletion']({
            materialId: id,
            token: deletion.token,
            descendantIds: []
          })
        )
      );
    });
  }

  function confirmPrune() {
    if (!prune) return;

    return run(async () => {
      const input = pruneInput ?? {
        materialId: id,
        policy: prune.policy,
        token: prune.token,
        candidateIds: prune.candidateIds,
        operationId: operationId.current
      };

      setPruneInput(input);
      client.setQueryData([...pruneKey, 'input'], input);
      setPruneOperation(await request((rpc) => rpc['materials.requestHistoryPrune'](input)));
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
