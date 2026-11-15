import { useAtom } from '@effect/atom-react';
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
import { rpc } from '@study/contracts/react';
import { toastManager } from '@study/ui/toast';
import { Atom } from 'effect/reactivity';
import { useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

type DeletePreview = typeof materialDeletionPreviewSchema.Type;

type DeleteOperation = typeof materialDeletionSchema.Type;

type PrunePreview = typeof historyPreviewSchema.Type;

type PruneOperation = typeof historyPruneSchema.Type;

type Confirmation =
  | { kind: 'delete'; input: Parameters<typeof rpc.materials.requestDeletion.call>[0] }
  | { kind: 'prune'; input: typeof requestHistoryPruneSchema.Type };

const intents = Atom.family((_id: MaterialId) =>
  Atom.make<{ operation?: PruneOperation; input?: typeof requestHistoryPruneSchema.Type }>({}).pipe(
    Atom.keepAlive
  )
);

/** Coordinates material cleanup previews, confirmed mutations and recovery against the selected material. */
export function useMaterialLifecycle(id: MaterialId) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [mode, setMode] = useState<'delete' | 'prune'>();
  const [deletion, setDeletion] = useState<DeletePreview>();
  const [prune, setPrune] = useState<PrunePreview>();
  const [deleteOperation, setDeleteOperation] = useState<DeleteOperation>();

  const [intent, setIntent] = useAtom(intents(id));
  const pruneOperation = intent.operation;
  const pruneInput = intent.input;

  function setPruneOperation(operation: PruneOperation | undefined) {
    setIntent((value) => ({ ...value, operation }));
  }

  function setPruneInput(input: typeof requestHistoryPruneSchema.Type | undefined) {
    setIntent((value) => ({ ...value, input }));
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
        setDeletion(await rpc.materials.previewDeletion.read({ materialId: id }));
      else {
        operationId.current = crypto.randomUUID();
        setPrune(
          await rpc.materials.previewHistoryPrune.read({
            materialId: id,
            policy: { keepLatest: Number(keep) }
          })
        );
      }
    });
  }

  function confirmDeletion() {
    if (deletion)
      setConfirmation({
        kind: 'delete',
        input: { materialId: id, token: deletion.token }
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
        result = await rpc.materials.requestDeletion.call(submitted.input);
        setDeleteOperation(result);
      } else {
        setPruneInput(submitted.input);
        result = await rpc.materials.requestHistoryPrune.call(submitted.input);
        setPruneOperation(result);
      }

      if (result.status === 'failed') {
        toastManager.add({ title: t('PageCleanupFailed'), type: 'error' });

        return;
      }

      toastManager.add({
        title: t(result.status === 'completed' ? 'PageCleanupCompleted' : 'PageCleanupPending'),
        type: result.status === 'completed' ? 'success' : 'info'
      });
      setConfirmation(undefined);
    });
  }

  function retryPruneInput() {
    if (!pruneInput) return;

    return run(async () => {
      setPruneOperation(await rpc.materials.requestHistoryPrune.call(pruneInput));
    });
  }

  function refreshOperation() {
    return run(async () => {
      if (mode === 'delete')
        setDeleteOperation(await rpc.materials.deletion.read({ materialId: id }));
      else if (pruneOperation)
        setPruneOperation(
          await rpc.materials.historyPrune.read({ operationId: pruneOperation.operationId })
        );
    });
  }

  function retryOperation() {
    return run(async () => {
      if (mode === 'delete')
        setDeleteOperation(await rpc.materials.retryDeletion.call({ materialId: id }));
      else if (pruneOperation)
        setPruneOperation(
          await rpc.materials.retryHistoryPrune.call({ operationId: pruneOperation.operationId })
        );
    });
  }

  function nextPrune() {
    setPruneOperation(undefined);
    setPruneInput(undefined);
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
  const state = rpc.materials.deletion.useQuery({ materialId: id });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);

  async function retry() {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setFailed(false);

    try {
      await rpc.materials.retryDeletion.call({ materialId: id });
    } catch {
      setFailed(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return { state, busy, failed, retry };
}
