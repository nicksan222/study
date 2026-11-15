import type { NoteId } from '@study/contracts/ids';
import type { noteWorkPageSchema } from '@study/contracts/notes/work';
import { rpc } from '@study/contracts/react';
import { WorkActivityIcon, CancelIcon } from '@study/icons';
import { LoadMoreButton } from '@study/ui/action-button';
import { AiActivity } from '@study/ui/ai-button';
import { Button } from '@study/ui/button';
import { Disclosure } from '@study/ui/disclosure';
import { ErrorState } from '@study/ui/error-state';
import { IconButton } from '@study/ui/icon-button';
import { Loading } from '@study/ui/loading';
import { WorkspaceWork } from '@study/ui/workspace';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { AgentProgress } from '../agent-progress';
import { ConfigurationWait } from './configuration-wait';
import { useStopNoteWork } from './note-pending-work.queries';
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
  const [before, setBefore] = useState<typeof noteWorkPageSchema.Type.next>();
  const query = rpc.notes.noteWork.useQuery({ noteId: id, limit: 20, before: before ?? undefined });
  const state = {
    ...query,
    hasNextPage: !!query.data?.next,
    isFetchingNextPage: query.isFetching,
    fetchNextPage: () => setBefore(query.data?.next ?? undefined)
  };
  const items = [...new Map(state.data?.items.map((item) => [item.execution.id, item])).values()];
  const refresh = async () => {
    try {
      await rpc.notes.noteWork.read({ noteId: id, limit: 20 });
      state.refetch();

      return true;
    } catch {
      return false;
    }
  };

  return (
    <WorkspaceWork.Root aria-label={t('NoteWorkHeading')}>
      <WorkspaceWork.Heading>
        <WorkActivityIcon size={13} aria-hidden="true" />
        <h2>{t('NoteWorkHeading')}</h2>
      </WorkspaceWork.Heading>
      {state.isPending && <Loading label={t('NoteWorkLoading')} />}
      {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
      {state.isSuccess && !items.length && (
        <WorkspaceWork.Empty>{t('NoteWorkEmpty')}</WorkspaceWork.Empty>
      )}
      <WorkspaceWork.List>
        {items.map((item) => (
          <WorkRow key={item.execution.id} item={item} refresh={refresh} />
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

function WorkRow({ item, refresh }: { item: NoteWorkItem; refresh: () => Promise<boolean> }) {
  const { t } = useI18n();
  const cancel = useStopNoteWork();
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
        onClick={() => {
          void cancel.mutate(item).catch(() => {});
        }}
      >
        <CancelIcon size={14} aria-hidden="true" />
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
