import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { NoteId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';
import { Button } from '@study/ui/button';
import { DangerDialog } from '@study/ui/danger-dialog';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/note-workspace';
import { StatusMessage } from '@study/ui/status-message';
import { toastManager } from '@study/ui/toast';
import { WorkspaceSurface } from '@study/ui/workspace';
import { Atom } from 'effect/reactivity';
import { useContext, useCallback, useEffect, useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import type { SelectedNote } from './page-creation-dialog';
import { NoteError, NoteReadError } from './status';

type DeletionAttempt = { started: boolean; pending: boolean; announced?: string };

export const deletionAttempt = Atom.family((_id: NoteId) =>
  Atom.make<DeletionAttempt>({ started: false, pending: false }).pipe(Atom.keepAlive)
);

export function useDeletionReceipt(id: NoteId, enabled = true) {
  const query = rpc.notes.noteDeletion.useQuery({ id }, { enabled });
  const absent = query.error !== undefined && toStudyError(query.error).kind === 'not_found';

  return {
    ...query,
    data: absent ? null : query.data,
    error: absent ? undefined : query.error,
    isSuccess: absent || query.isSuccess,
    isError: !absent && query.isError
  };
}

/** Local attempt ownership survives navigation; authoritative receipts come from the server. */
function useNoteDeletion(id: NoteId, enabled = true) {
  const { t } = useI18n();
  const registry = useContext(RegistryContext);
  const atom = deletionAttempt(id);
  const attempt = useAtomValue(atom);
  const state = useDeletionReceipt(id, enabled);
  const notificationOwner = useRef(false);
  const remove = rpc.notes.delete.useMutation();
  const retryOperation = rpc.notes.retryNoteDeletion.useMutation();

  async function submit(retry: boolean) {
    if (registry.get(atom).pending) return;

    notificationOwner.current = true;
    registry.update(atom, (previous) => ({ ...previous, started: true, pending: true }));

    try {
      await (retry ? retryOperation.mutate({ id }) : remove.mutate({ id }));
    } catch (error) {
      if (toStudyError(error).kind === 'invalid_input')
        registry.update(atom, (previous) => ({ ...previous, started: false }));
    } finally {
      registry.update(atom, (previous) => ({ ...previous, pending: false }));
    }
  }

  const mutation = {
    ...remove,
    mutate: () => {
      void submit(false);
    }
  };
  const retry = {
    ...retryOperation,
    mutate: () => {
      void submit(true);
    }
  };

  useEffect(() => {
    const receipt = state.data;

    if (
      !notificationOwner.current ||
      receipt?.status !== 'completed' ||
      registry.get(atom).announced === receipt.operationId
    )
      return;

    registry.update(atom, (previous) => ({ ...previous, announced: receipt.operationId }));
    toastManager.add({ title: t('NoteDeleted'), type: 'success' });
  }, [state.data, attempt.started, t, registry, atom]);

  return {
    state,
    mutation,
    retry,
    started: attempt.started,
    pending: attempt.pending,
    available: state.isSuccess && state.data === null,
    owned: notificationOwner.current
  };
}

type DeletionFlow = ReturnType<typeof useNoteDeletion>;

/** Exposes mutation and receipt read failures with the recovery each operation permits. */

function DeleteErrors({ flow }: { flow: DeletionFlow }) {
  const { state, mutation, retry, pending } = flow;

  return (
    <>
      {mutation.error && (
        <NoteError error={mutation.error} retry={pending ? undefined : () => mutation.mutate()} />
      )}
      {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
      {retry.error && <NoteError error={retry.error} />}
    </>
  );
}

/** Reports loading, deletion progress and committed completion from the shared receipt. */

function DeleteStatus({ flow }: { flow: DeletionFlow }) {
  const { t } = useI18n();
  const { state, pending } = flow;

  return (
    <>
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {(pending || state.data?.status === 'pending') && <Loading label={t('NoteDeleting')} />}
      {state.data?.status === 'completed' && <StatusMessage>{t('NoteDeleted')}</StatusMessage>}
    </>
  );
}

function DeleteFeedback({ flow }: { flow: DeletionFlow }) {
  return (
    <>
      <DeleteErrors flow={flow} />
      <DeleteStatus flow={flow} />
    </>
  );
}

/** Shows recovery for an interrupted note deletion without restoring deleted note content. */

export function NoteDeletion({ id }: { id: NoteId }) {
  const { t } = useI18n();
  const flow = useNoteDeletion(id);

  return (
    <WorkspaceSurface.Deletion aria-label={t('NoteDelete')}>
      <p>{t('NoteDeleteHelp')}</p>
      <DeleteFeedback flow={flow} />
      {flow.state.data?.status === 'failed' && (
        <ErrorState
          layout="inline"
          title={t('NoteDeleteFailed')}
          action={
            <Button disabled={flow.pending} onClick={() => flow.retry.mutate()}>
              {t('NoteRetryDelete')}
            </Button>
          }
        />
      )}
    </WorkspaceSurface.Deletion>
  );
}

/** Confirms deletion once per attempt and closes only after its owned operation completes. */

export function NoteDeleteDialog({
  id,
  open,
  onOpenChange
}: {
  id: NoteId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const flow = useNoteDeletion(id, open);
  const retryable = flow.state.data?.status === 'failed';
  const pending = flow.pending || flow.state.data?.status === 'pending';

  useEffect(() => {
    if (flow.owned && flow.state.data?.status === 'completed') onOpenChange(false);
  }, [flow.owned, flow.state.data?.status, onOpenChange]);

  return (
    <DangerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('NoteDelete')}
      confirmation={{
        value: t('DeleteConfirmationWord'),
        label: t('DeleteConfirmationInstruction', { word: t('DeleteConfirmationWord') }),
        identity: String(id)
      }}
      description={t('NoteDeleteHelp')}
      confirmLabel={t(retryable ? 'NoteRetryDelete' : 'NoteConfirmDelete')}
      cancelLabel={t(flow.state.data?.status === 'completed' ? 'Close' : 'Cancel')}
      pending={pending}
      disabled={!retryable && (!flow.available || flow.started)}
      onConfirm={() => {
        if (pending) return;

        if (retryable) flow.retry.mutate();
        else if (flow.available && !flow.started) flow.mutation.mutate();
      }}
    >
      <DeleteFeedback flow={flow} />
    </DangerDialog>
  );
}

type BatchDeletionStatus = { pending: boolean; ready: boolean; complete: boolean };

/** Keeps the reviewed target set fixed while each existing deletion flow owns its request and recovery. */

export function NoteBatchDeleteDialog({
  notes,
  open,
  onOpenChange,
  onDeleted
}: {
  notes: readonly SelectedNote[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (ids: readonly NoteId[]) => void;
}) {
  const [review, setReview] = useState({ open, notes });

  if (review.open !== open) setReview({ open, notes: open ? notes : review.notes });

  const targets = review.notes;
  const identity = targets.map((note) => String(note.id)).join(',');

  return (
    <BatchDeletion
      key={identity}
      notes={targets}
      open={open}
      onOpenChange={onOpenChange}
      onDeleted={onDeleted}
    />
  );
}

function BatchDeletion({
  notes,
  open,
  onOpenChange,
  onDeleted
}: {
  notes: readonly SelectedNote[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (ids: readonly NoteId[]) => void;
}) {
  const { t } = useI18n();
  const [confirmed, setConfirmed] = useState(false);
  const [statuses, setStatuses] = useState<ReadonlyMap<NoteId, BatchDeletionStatus>>(new Map());
  const report = useCallback((id: NoteId, status: BatchDeletionStatus) => {
    setStatuses((previous) => {
      const current = previous.get(id);

      if (
        current?.pending === status.pending &&
        current?.ready === status.ready &&
        current?.complete === status.complete
      )
        return previous;

      return new Map(previous).set(id, status);
    });
  }, []);
  const pending = confirmed && [...statuses.values()].some((status) => status.pending);
  const ready =
    notes.length > 0 &&
    notes.every((note) => statuses.get(note.id)?.ready || statuses.get(note.id)?.complete);
  const completed = notes.length > 0 && notes.every((note) => statuses.get(note.id)?.complete);

  useEffect(() => {
    if (confirmed && completed) onOpenChange(false);
  }, [confirmed, completed, onOpenChange]);

  return (
    <DangerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('NoteBatchDelete')}
      description={t('NoteBatchDeleteHelp')}
      confirmation={{
        identity: notes.map((note) => String(note.id)).join(','),
        value: t('DeleteConfirmationWord'),
        label: t('DeleteConfirmationInstruction', { word: t('DeleteConfirmationWord') })
      }}
      confirmLabel={t('NoteBatchConfirmDelete')}
      cancelLabel={t(confirmed ? 'Close' : 'Cancel')}
      pending={pending}
      disabled={confirmed || !ready}
      onConfirm={() => {
        if (ready && !pending) setConfirmed(true);
      }}
    >
      {notes.map((note) => (
        <BatchDeletionItem
          key={String(note.id)}
          note={note}
          open={open}
          confirmed={confirmed}
          report={report}
          onDeleted={onDeleted}
        />
      ))}
    </DangerDialog>
  );
}

type BatchDeletionItemProps = {
  note: SelectedNote;
  open: boolean;
  confirmed: boolean;
  report: (id: NoteId, status: BatchDeletionStatus) => void;
  onDeleted?: (ids: readonly NoteId[]) => void;
};

function useBatchDeletionItem({
  note,
  open,
  confirmed,
  report,
  onDeleted
}: BatchDeletionItemProps) {
  const flow = useNoteDeletion(note.id, open);
  const attempted = useRef(false);
  const announced = useRef(false);
  const receipt = flow.state.data;
  const retryable = receipt?.status === 'failed';
  const pending = flow.pending || receipt?.status === 'pending';
  const ready = retryable || (flow.available && !flow.started);

  useEffect(() => {
    report(note.id, { pending, ready, complete: receipt?.status === 'completed' });
  }, [note.id, pending, ready, receipt?.status, report]);
  const retryDeletion = flow.retry.mutate;
  const deleteNote = flow.mutation.mutate;

  useEffect(() => {
    if (confirmed && !attempted.current) {
      attempted.current = true;

      if (retryable) retryDeletion();
      else if (flow.available && !flow.started) deleteNote();
    }
  }, [confirmed, retryable, flow.available, flow.started, retryDeletion, deleteNote]);
  useEffect(() => {
    if (receipt && !announced.current) {
      announced.current = true;
      onDeleted?.([note.id]);
    }
  }, [receipt, note.id, onDeleted]);

  return { flow, retryable, pending };
}

function BatchDeletionItem(props: BatchDeletionItemProps) {
  const { t } = useI18n();
  const { note, confirmed } = props;
  const { flow, retryable, pending } = useBatchDeletionItem(props);

  return (
    <Notebook.BatchDeletionItem>
      <strong>{note.title || t('NoteUntitled')}</strong>
      <DeleteFeedback flow={flow} />
      {confirmed && retryable && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => flow.retry.mutate()}>
          {t('NoteRetryDelete')}
        </Button>
      )}
      {flow.started && flow.available && !flow.mutation.error && <p>{t('NoteBatchUncertain')}</p>}
      {flow.started && flow.available && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void flow.state.refetch()}
        >
          {t('LibraryRefresh')}
        </Button>
      )}
    </Notebook.BatchDeletionItem>
  );
}
