import type { sessionDeletionSchema } from '@study/contracts/conversations/deletion';
import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { DangerDialog } from '@study/ui/danger-dialog';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { StatusMessage } from '@study/ui/status-message';
import { toastManager } from '@study/ui/toast';
import { WorkspaceSurface } from '@study/ui/workspace';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { toStudyError } from '#web/lib/study-client/errors.ts';

import type { SelectedSession } from './document-creation-dialog';
import {
  deleteSessionMutationOptions,
  deletionOptions,
  deletionAttemptOptions,
  retrySessionDeletionMutationOptions,
  sessionKey
} from './session-workspace.queries';
import { SessionError, SessionReadError } from './status';

/** Shares deletion receipts through the query cache while keeping success announcements owned by the initiating observer. */

function useSessionDeletion(id: SessionId, enabled = true) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const attempt = useQuery(deletionAttemptOptions(id));
  const started = attempt.data;
  const setStarted = (value: boolean) =>
    cache.setQueryData(deletionAttemptOptions(id).queryKey, value);
  const state = useQuery(deletionOptions(id, enabled));
  const mutationKey = [...sessionKey(id), 'delete'];
  const pending = useIsMutating({ mutationKey, exact: true }) > 0;
  const notificationOwner = useRef(false);
  const ownAttempt = () => {
    notificationOwner.current = true;
    setStarted(true);
  };
  const commitReceipt = (value: typeof sessionDeletionSchema.Type) => {
    cache.setQueryData(deletionOptions(id, true).queryKey, value);
    void cache.invalidateQueries({ queryKey: ['sessions'] });
  };
  const mutation = useMutation({
    mutationKey,
    ...deleteSessionMutationOptions(id),
    onMutate: ownAttempt,
    onSuccess: commitReceipt,
    onError: (error) => {
      if (toStudyError(error).kind === 'invalid_input') {
        setStarted(false);
      }

      void cache.invalidateQueries({ queryKey: deletionOptions(id, true).queryKey });
    }
  });
  const retry = useMutation({
    mutationKey,
    ...retrySessionDeletionMutationOptions(id),
    onMutate: ownAttempt,
    onSuccess: commitReceipt
  });
  const announcementKey = useMemo(() => [...sessionKey(id), 'deletion-announced'], [id]);

  cache.setQueryDefaults(announcementKey, { gcTime: Infinity });
  useEffect(() => {
    const receipt = state.data;

    if (
      !notificationOwner.current ||
      receipt?.status !== 'completed' ||
      cache.getQueryData(announcementKey) === receipt.operationId
    )
      return;

    cache.setQueryData(announcementKey, receipt.operationId);
    toastManager.add({ title: t('SessionDeleted'), type: 'success' });
  }, [state.data, started, t, cache, announcementKey]);
  const available = state.isSuccess && state.data === null;

  return { state, mutation, retry, started, pending, available, owned: notificationOwner.current };
}

type DeletionFlow = ReturnType<typeof useSessionDeletion>;

/** Exposes mutation and receipt read failures with the recovery each operation permits. */

function DeleteErrors({ flow }: { flow: DeletionFlow }) {
  const { state, mutation, retry, pending } = flow;

  return (
    <>
      {mutation.error && (
        <SessionError
          error={mutation.error}
          retry={pending ? undefined : () => mutation.mutate()}
        />
      )}
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {retry.error && <SessionError error={retry.error} />}
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
      {(pending || state.data?.status === 'pending') && <Loading label={t('SessionDeleting')} />}
      {state.data?.status === 'completed' && <StatusMessage>{t('SessionDeleted')}</StatusMessage>}
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

/** Shows recovery for an interrupted session deletion without restoring deleted session content. */

export function SessionDeletion({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const flow = useSessionDeletion(id);

  return (
    <WorkspaceSurface.Deletion aria-label={t('SessionDelete')}>
      <p>{t('SessionDeleteHelp')}</p>
      <DeleteFeedback flow={flow} />
      {flow.state.data?.status === 'failed' && (
        <ErrorState
          layout="inline"
          title={t('SessionDeleteFailed')}
          action={
            <Button disabled={flow.pending} onClick={() => flow.retry.mutate()}>
              {t('SessionRetryDelete')}
            </Button>
          }
        />
      )}
    </WorkspaceSurface.Deletion>
  );
}

/** Confirms deletion once per attempt and closes only after its owned operation completes. */

export function SessionDeleteDialog({
  id,
  open,
  onOpenChange
}: {
  id: SessionId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const flow = useSessionDeletion(id, open);
  const retryable = flow.state.data?.status === 'failed';
  const pending = flow.pending || flow.state.data?.status === 'pending';

  useEffect(() => {
    if (flow.owned && flow.state.data?.status === 'completed') onOpenChange(false);
  }, [flow.owned, flow.state.data?.status, onOpenChange]);

  return (
    <DangerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('SessionDelete')}
      confirmation={{
        value: t('DeleteConfirmationWord'),
        label: t('DeleteConfirmationInstruction', { word: t('DeleteConfirmationWord') }),
        identity: String(id)
      }}
      description={t('SessionDeleteHelp')}
      confirmLabel={t(retryable ? 'SessionRetryDelete' : 'SessionConfirmDelete')}
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

export function SessionBatchDeleteDialog({
  sessions,
  open,
  onOpenChange,
  onDeleted
}: {
  sessions: readonly SelectedSession[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (ids: readonly SessionId[]) => void;
}) {
  const [review, setReview] = useState({ open, sessions });

  if (review.open !== open) setReview({ open, sessions: open ? sessions : review.sessions });

  const targets = review.sessions;
  const identity = targets.map((session) => String(session.id)).join(',');

  return (
    <BatchDeletion
      key={identity}
      sessions={targets}
      open={open}
      onOpenChange={onOpenChange}
      onDeleted={onDeleted}
    />
  );
}

function BatchDeletion({
  sessions,
  open,
  onOpenChange,
  onDeleted
}: {
  sessions: readonly SelectedSession[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (ids: readonly SessionId[]) => void;
}) {
  const { t } = useI18n();
  const [confirmed, setConfirmed] = useState(false);
  const [statuses, setStatuses] = useState<ReadonlyMap<SessionId, BatchDeletionStatus>>(new Map());
  const report = useCallback((id: SessionId, status: BatchDeletionStatus) => {
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
    sessions.length > 0 &&
    sessions.every(
      (session) => statuses.get(session.id)?.ready || statuses.get(session.id)?.complete
    );
  const completed =
    sessions.length > 0 && sessions.every((session) => statuses.get(session.id)?.complete);

  useEffect(() => {
    if (confirmed && completed) onOpenChange(false);
  }, [confirmed, completed, onOpenChange]);

  return (
    <DangerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('SessionBatchDelete')}
      description={t('SessionBatchDeleteHelp')}
      confirmation={{
        identity: sessions.map((session) => String(session.id)).join(','),
        value: t('DeleteConfirmationWord'),
        label: t('DeleteConfirmationInstruction', { word: t('DeleteConfirmationWord') })
      }}
      confirmLabel={t('SessionBatchConfirmDelete')}
      cancelLabel={t(confirmed ? 'Close' : 'Cancel')}
      pending={pending}
      disabled={confirmed || !ready}
      onConfirm={() => {
        if (ready && !pending) setConfirmed(true);
      }}
    >
      {sessions.map((session) => (
        <BatchDeletionItem
          key={String(session.id)}
          session={session}
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
  session: SelectedSession;
  open: boolean;
  confirmed: boolean;
  report: (id: SessionId, status: BatchDeletionStatus) => void;
  onDeleted?: (ids: readonly SessionId[]) => void;
};

function useBatchDeletionItem({
  session,
  open,
  confirmed,
  report,
  onDeleted
}: BatchDeletionItemProps) {
  const flow = useSessionDeletion(session.id, open);
  const attempted = useRef(false);
  const announced = useRef(false);
  const receipt = flow.state.data;
  const retryable = receipt?.status === 'failed';
  const pending = flow.pending || receipt?.status === 'pending';
  const ready = retryable || (flow.available && !flow.started);

  useEffect(() => {
    report(session.id, { pending, ready, complete: receipt?.status === 'completed' });
  }, [session.id, pending, ready, receipt?.status, report]);
  const retryDeletion = flow.retry.mutate;
  const deleteSession = flow.mutation.mutate;

  useEffect(() => {
    if (confirmed && !attempted.current) {
      attempted.current = true;

      if (retryable) retryDeletion();
      else if (flow.available && !flow.started) deleteSession();
    }
  }, [confirmed, retryable, flow.available, flow.started, retryDeletion, deleteSession]);
  useEffect(() => {
    if (receipt && !announced.current) {
      announced.current = true;
      onDeleted?.([session.id]);
    }
  }, [receipt, session.id, onDeleted]);

  return { flow, retryable, pending };
}

function BatchDeletionItem(props: BatchDeletionItemProps) {
  const { t } = useI18n();
  const { session, confirmed } = props;
  const { flow, retryable, pending } = useBatchDeletionItem(props);

  return (
    <Notebook.BatchDeletionItem>
      <strong>{session.title || t('SessionUntitled')}</strong>
      <DeleteFeedback flow={flow} />
      {confirmed && retryable && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => flow.retry.mutate()}>
          {t('SessionRetryDelete')}
        </Button>
      )}
      {flow.started && flow.available && !flow.mutation.error && (
        <p>{t('SessionBatchUncertain')}</p>
      )}
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
