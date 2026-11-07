import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { IconButton } from '@study/ui/icon-button';
import { Thinking } from '@study/ui/loading';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { AgentProgress } from '../agent-progress';
import type { MessageWorkTarget } from './message-work-details';
import { sessionWorkKey, stopSessionWorkOptions } from './session-pending-work.queries';
import { executionOptions, provenanceOptions, sessionKey } from './session-workspace.queries';
import { SessionReadError } from './status';

export function PendingMessageWork(target: MessageWorkTarget) {
  const { t } = useI18n();
  const provenance = useQuery({
    ...provenanceOptions(target.sessionId, target.messageId, target.versionId),
    select: (receipt) => (receipt.state === 'available' ? receipt.requestId : undefined)
  });
  const requestId = provenance.isError ? undefined : provenance.data;

  if (requestId)
    return <PendingRequestWork key={requestId} requestId={requestId} target={target} />;

  return (
    <>
      <Thinking label={t('SessionThinking')} />
      {provenance.error && (
        <SessionReadError error={provenance.error} retry={() => void provenance.refetch()} />
      )}
    </>
  );
}

function PendingRequestWork({
  requestId,
  target
}: {
  requestId: string;
  target: MessageWorkTarget;
}) {
  const { t } = useI18n();
  const { work, cancel, execution, stopping, showCancel } = usePendingRequestWork(
    requestId,
    target
  );

  return (
    <>
      <Thinking
        label={t(stopping ? 'SessionWorkStopping' : 'SessionThinking')}
        action={
          execution &&
          showCancel && (
            <IconButton
              size="icon-sm"
              variant="ghost-muted"
              label={t('SessionCancel')}

              disabled={stopping || cancel.isError || !execution.canCancel}
              onClick={() => cancel.mutate({ kind: 'reply', title: null, requestId, execution })}
            >
              <X aria-hidden="true" />
            </IconButton>
          )
        }
      />
      {execution && !stopping && <AgentProgress executionId={execution.id} />}
      {work.error && <SessionReadError error={work.error} retry={() => void work.refetch()} />}
      {cancel.isError && (
        <ErrorState
          title={t('SessionWorkStopError')}
          action={
            <Button
              size="sm"
              variant="ghost-muted"
              onClick={async () => {
                const result = await work.refetch();

                if (!result.isError) cancel.reset();
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

function usePendingRequestWork(requestId: string, target: MessageWorkTarget) {
  const cache = useQueryClient();
  const work = useQuery(executionOptions(requestId));
  const execution = work.isError ? undefined : work.data?.items[0];
  const cancel = useMutation({
    ...stopSessionWorkOptions(),
    onSettled: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: sessionKey(target.sessionId) }),
        cache.invalidateQueries({ queryKey: sessionWorkKey(target.sessionId) }),
        cache.invalidateQueries({ queryKey: ['session-execution', requestId] }),
        cache.invalidateQueries({ queryKey: ['sessions', 'sidebar-progress'] })
      ]);
    }
  });
  const stopping = cancel.isPending || execution?.status === 'cancelling';

  const showCancel = execution?.canCancel || stopping || cancel.isError;

  return { work, cancel, execution, stopping, showCancel };
}
