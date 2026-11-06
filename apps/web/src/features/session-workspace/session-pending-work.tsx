import type { SessionId } from '@study/contracts/ids';
import { LoadMoreButton } from '@study/ui/action-button';
import { AiActivity } from '@study/ui/ai-button';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { IconButton } from '@study/ui/icon-button';
import { Loading } from '@study/ui/loading';
import { WorkspaceWork } from '@study/ui/workspace';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, X } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import {
  sessionWorkKey,
  sessionWorkOptions,
  stopSessionWorkOptions
} from './session-pending-work.queries';
import type { SessionWorkItem } from './session-pending-work.queries';
import { SessionReadError } from './status';

const kinds = {
  transform: { label: 'SessionWorkTransform' },
  reply: { label: 'SessionWorkReply' },
  attachment: { label: 'SessionWorkAttachment' },
  title: { label: 'SessionWorkTitle' }
} as const;

/** Shows committed work for this notebook independently of the selected dialog. */
export function SessionPendingWork({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const state = useInfiniteQuery(sessionWorkOptions(id));
  const items = [
    ...new Map(
      state.data?.pages.flatMap((page) => page.items).map((item) => [item.execution.id, item])
    ).values()
  ];
  const refresh = async () => !(await state.refetch()).isError;

  return (
    <WorkspaceWork.Root aria-label={t('SessionWorkHeading')}>
      <WorkspaceWork.Heading>
        <Activity size={13} aria-hidden="true" />
        <h2>{t('SessionWorkHeading')}</h2>
      </WorkspaceWork.Heading>
      {state.isPending && <Loading label={t('SessionWorkLoading')} />}
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {state.isSuccess && !items.length && (
        <WorkspaceWork.Empty>{t('SessionWorkEmpty')}</WorkspaceWork.Empty>
      )}
      <WorkspaceWork.List>
        {items.map((item) => (
          <WorkRow key={item.execution.id} id={id} item={item} refresh={refresh} />
        ))}
      </WorkspaceWork.List>
      {state.hasNextPage && (
        <LoadMoreButton
          size="sm"
          variant="ghost-muted"
          disabled={state.isFetchingNextPage}
          onClick={() => void state.fetchNextPage()}
          label={t('LibraryMore')}
        />
      )}
    </WorkspaceWork.Root>
  );
}

function WorkRow({
  id,
  item,
  refresh
}: {
  id: SessionId;
  item: SessionWorkItem;
  refresh: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const cancel = useMutation({
    ...stopSessionWorkOptions(),
    onSettled: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: sessionWorkKey(id) }),
        cache.invalidateQueries({ queryKey: ['session-workspace', String(id), 'generations'] }),
        cache.invalidateQueries({ queryKey: ['session-generation', item.requestId] }),
        cache.invalidateQueries({ queryKey: ['session-execution', item.requestId] }),
        cache.invalidateQueries({ queryKey: ['sessions', 'sidebar-progress'] })
      ]);
    }
  });
  const status = item.execution.status;
  const stopping = cancel.isPending || status === 'cancelling';
  const stateLabel = workStateLabel(item, stopping);
  const { label } = kinds[item.kind];
  const title = item.title || t(label);

  return (
    <WorkspaceWork.Row>
      <AiActivity label={title + ' · ' + t(stateLabel)} />
      <WorkspaceWork.Copy>
        <strong title={title}>{title}</strong>
      </WorkspaceWork.Copy>
      <IconButton
        size="icon-sm"
        variant="ghost-muted"
        label={t('SessionWorkStop', { title })}

        disabled={stopping || !item.execution.canCancel || cancel.isError}
        aria-busy={stopping}
        onClick={() => cancel.mutate(item)}
      >
        <X size={14} aria-hidden="true" />
      </IconButton>
      {cancel.isError && (
        <WorkspaceWork.Error>
          <ErrorState
            title={t('SessionWorkStopError')}
            action={
              <Button
                size="sm"
                variant="ghost-muted"
                onClick={async () => {
                  if (await refresh()) cancel.reset();
                }}
              >
                {t('LibraryRefresh')}
              </Button>
            }
          />
        </WorkspaceWork.Error>
      )}
    </WorkspaceWork.Row>
  );
}

function workStateLabel(item: SessionWorkItem, stopping: boolean) {
  if (stopping) return 'SessionWorkStopping';

  if (item.execution.outcome === 'failure') return 'SessionWorkAttention';

  if (item.execution.status === 'suspended') return 'SessionWorkWaiting';

  return 'SessionWorkRunning';
}
