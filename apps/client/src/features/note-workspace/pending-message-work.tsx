import { rpc } from '@study/contracts/react';
import { CancelIcon } from '@study/icons';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { IconButton } from '@study/ui/icon-button';
import { Thinking } from '@study/ui/loading';

import { useI18n } from '#client/lib/i18n.tsx';

import { AgentProgress } from '../agent-progress';
import type { MessageWorkTarget } from './message-work-details';
import { useStopNoteWork } from './note-pending-work.queries';
import { NoteReadError } from './status';
import { workActivityState } from './work-state';

export function PendingMessageWork(target: MessageWorkTarget) {
  const { t } = useI18n();
  const provenance = rpc.notes.replyVersion.useQuery({
    noteId: target.noteId,
    messageId: target.messageId,
    versionId: target.versionId
  });
  const requestId =
    provenance.isError || provenance.data?.state !== 'available'
      ? undefined
      : provenance.data.requestId;

  if (requestId) return <PendingRequestWork key={requestId} requestId={requestId} />;

  return (
    <>
      <Thinking label={t('NoteThinking')} />
      {provenance.error && (
        <NoteReadError error={provenance.error} retry={() => void provenance.refetch()} />
      )}
    </>
  );
}

function PendingRequestWork({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const model = usePendingRequestWork(requestId);
  const { work, cancel, execution, stopping } = model;

  return (
    <>
      <PendingWorkStatus model={model} requestId={requestId} />
      {execution && !stopping && <AgentProgress executionId={execution.id} />}
      {work.error && <NoteReadError error={work.error} retry={() => void work.refetch()} />}
      {cancel.isError && (
        <ErrorState
          title={t('NoteWorkStopError')}
          action={
            <Button
              size="sm"
              variant="ghost-muted"
              onClick={async () => {
                try {
                  await rpc.workflows.executions.read({ correlationId: requestId, limit: 30 });
                  work.refetch();
                  cancel.reset();
                } catch {}
              }}
            >
              {t('LibraryRefresh')}
            </Button>
          }
        />
      )}
    </>
  );
}

function PendingWorkStatus({
  model,
  requestId
}: {
  model: ReturnType<typeof usePendingRequestWork>;
  requestId: string;
}) {
  const { t } = useI18n();
  const { execution, stopping, showCancel, cancel } = model;
  const state = workActivityState(execution, stopping);
  const labels = {
    stopping: 'NoteWorkStopping',
    waiting: 'NoteWorkWaiting',
    running: 'NoteThinking',
    attention: 'NoteWorkAttention'
  } as const;

  return (
    <Thinking
      label={t(labels[state])}
      state={state}
      action={
        execution &&
        showCancel && (
          <IconButton
            size="icon-sm"
            variant="ghost-muted"
            label={t('NoteCancel')}
            disabled={stopping || cancel.isError || !execution.canCancel}
            onClick={() => cancel.mutate({ kind: 'reply', title: null, requestId, execution })}
          >
            <CancelIcon aria-hidden="true" />
          </IconButton>
        )
      }
    />
  );
}

function usePendingRequestWork(requestId: string) {
  const work = rpc.workflows.executions.useQuery({ correlationId: requestId, limit: 30 });
  const execution = work.isError ? undefined : work.data?.items[0];
  const cancel = useStopNoteWork();
  const stopping = cancel.isPending || execution?.status === 'cancelling';

  const showCancel = execution?.canCancel || stopping || cancel.isError;

  return { work, cancel, execution, stopping, showCancel };
}
