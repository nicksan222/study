import type { NoteId } from '@study/contracts/ids';
import { LoadMoreButton } from '@study/ui/action-button';
import { AiActivity } from '@study/ui/ai-button';
import { Button } from '@study/ui/button';
import { Disclosure } from '@study/ui/disclosure';
import { ErrorState } from '@study/ui/error-state';
import { IconButton } from '@study/ui/icon-button';
import { Loading } from '@study/ui/loading';
import { WorkspaceWork } from '@study/ui/workspace';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, X } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { AgentProgress } from '../agent-progress';
import { ConfigurationWait } from './configuration-wait';
import { noteWorkKey, noteWorkOptions, stopNoteWorkOptions } from './note-pending-work.queries';
import type { NoteWorkItem } from './note-pending-work.queries';
import { NoteReadError } from './status';
import { workActivityState } from './work-state';

const kinds = {
  transform: { label: 'NoteWorkTransform' },
  reply: { label: 'NoteWorkReply' },
  attachment: { label: 'NoteWorkAttachment' },
  title: { label: 'NoteWorkTitle' }
} as const;

/** Shows committed work for this notebook independently of the selected dialog. */
export function NotePendingWork({ id }: { id: NoteId }) {
  const { t } = useI18n();
  const state = useInfiniteQuery(noteWorkOptions(id));
  const items = [
    ...new Map(
      state.data?.pages.flatMap((page) => page.items).map((item) => [item.execution.id, item])
    ).values()
  ];
  const refresh = async () => !(await state.refetch()).isError;

  return (
    <WorkspaceWork.Root aria-label={t('NoteWorkHeading')}>
      <WorkspaceWork.Heading>
        <Activity size={13} aria-hidden="true" />
        <h2>{t('NoteWorkHeading')}</h2>
      </WorkspaceWork.Heading>
      {state.isPending && <Loading label={t('NoteWorkLoading')} />}
      {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
      {state.isSuccess && !items.length && (
        <WorkspaceWork.Empty>{t('NoteWorkEmpty')}</WorkspaceWork.Empty>
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
  id: NoteId;
  item: NoteWorkItem;
  refresh: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const cancel = useMutation({
    ...stopNoteWorkOptions(),
    onSettled: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: noteWorkKey(id) }),
        cache.invalidateQueries({ queryKey: ['note-workspace', String(id), 'generations'] }),
        cache.invalidateQueries({ queryKey: ['note-generation', item.requestId] }),
        cache.invalidateQueries({ queryKey: ['note-execution', item.requestId] }),
        cache.invalidateQueries({ queryKey: ['notes', 'sidebar-progress'] })
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
      <WorkspaceWork.Copy>
        <strong>{t(label)}</strong>
        {item.title && <WorkspaceWork.Status title={item.title}>{item.title}</WorkspaceWork.Status>}
        <AiActivity label={t(stateLabel)} state={workActivityState(item.execution, stopping)} />
      </WorkspaceWork.Copy>
      <IconButton
        size="icon-sm"
        variant="ghost-muted"
        label={t('NoteWorkStop', { title })}

        disabled={stopping || !item.execution.canCancel || cancel.isError}
        aria-busy={stopping}
        onClick={() => cancel.mutate(item)}
      >
        <X size={14} aria-hidden="true" />
      </IconButton>
      {!stopping && item.execution.configurationWaitReason && (
        <WorkspaceWork.Progress>
          <ConfigurationWait reason={item.execution.configurationWaitReason} />
        </WorkspaceWork.Progress>
      )}
      {!stopping && (
        <WorkspaceWork.Progress>
          <Disclosure summary={t('NoteWorkDetails')}>
            <AgentProgress executionId={item.execution.id} variant="compact" />
          </Disclosure>
        </WorkspaceWork.Progress>
      )}
      {cancel.isError && (
        <WorkspaceWork.Error>
          <ErrorState
            title={t('NoteWorkStopError')}
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

function workStateLabel(item: NoteWorkItem, stopping: boolean) {
  if (stopping) return 'NoteWorkStopping';

  if (item.execution.outcome === 'failure') return 'NoteWorkAttention';

  if (item.execution.status === 'suspended') return 'NoteWorkWaiting';

  return 'NoteWorkRunning';
}
