import type { ProjectId } from '@study/contracts';
import type { materialGenerationSnapshotSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { QuizIcon, FlashcardsIcon, StopIcon, WorkActivityIcon, CancelIcon } from '@study/icons';
import { RetryButton } from '@study/ui';
import { ContextMenu, ContextMenuTrigger, ContextMenuPopup, ContextMenuItem } from '@study/ui';
import { ErrorState } from '@study/ui';
import { IconButton } from '@study/ui';
import { Sidebar } from '@study/ui';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import type { Subjects } from '#client/lib/study-client/types.ts';

import { AgentActivity, AgentActivityDetails } from '../agent-progress';
import { useGenerationRetry } from './sidebar-generations.queries';

type Generation = typeof materialGenerationSnapshotSchema.Type;

const generationKinds = {
  flashcards: { Icon: FlashcardsIcon, label: 'Flashcards' },
  quiz: { Icon: QuizIcon, label: 'SidebarQuiz' }
} as const;

/** Recover background practice work from persisted requests, including after navigation. */
export function PracticeSidebarGenerations({
  project,
  subjects,
  query,
  enabled
}: {
  project?: ProjectId;
  subjects: Subjects;
  query: string;
  enabled: boolean;
}) {
  const { t } = useI18n();
  const state = rpc.materials.activeMaterialGenerations.useQuery(
    { projectId: project },
    { enabled }
  );

  if (!enabled || (!state.isError && !state.data?.length)) return null;

  return (
    <Sidebar.Items aria-label={t('PracticeGenerationRunning')}>
      {state.isError && (
        <Sidebar.Message role="alert">{t('PracticeGenerationLoadError')}</Sidebar.Message>
      )}
      {(state.data ?? [])
        .filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .map((generation) => (
          <GenerationCard key={generation.id} generation={generation} subjects={subjects} />
        ))}
    </Sidebar.Items>
  );
}

function GenerationCard({ generation, subjects }: { generation: Generation; subjects: Subjects }) {
  const { t } = useI18n();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stop = rpc.materials.cancelMaterialGeneration.useMutation();
  const retry = useGenerationRetry(generation.id);
  const failed = generation.errorKind !== null && !retry.isPending;
  const owner = subjects.find((subject) => subject.id === generation.projectId);
  const { Icon, label } = generationKinds[generation.kind];
  const stopLabel = t('PracticeGenerationStop', { title: generation.title });
  const activity = generationActivity({
    stopping: stop.isPending,
    failed,
    retrying: retry.isPending
  });
  const status = t(activity.label);
  const controls = (
    <Sidebar.NoteRowActions placement="inline">
      {failed && <RetryButton label={t('Retry')} disabled={stop.isPending} onClick={retry.retry} />}
      <Sidebar.SettleAction
        aria-label={stopLabel}
        title={stopLabel}
        disabled={stop.isPending}
        onClick={() => void stop.mutate({ requestId: generation.id }).catch(() => {})}
      >
        <StopIcon aria-hidden="true" />
        {t('StopJob')}
      </Sidebar.SettleAction>
    </Sidebar.NoteRowActions>
  );

  return (
    <Sidebar.NoteEntry>
      <ContextMenu>
        <ContextMenuTrigger render={<div />}>
          <Sidebar.Item
            label={generation.title}
            context={owner?.name ?? t(label)}
            icon={<Icon aria-hidden="true" />}
            title={generation.title}
            render={<div />}
          />
          <Sidebar.WorkProgress>
            {failed ? (
              <ErrorState
                layout="sidebar"
                title={t('PracticeGenerationFailed')}
                action={controls}
              />
            ) : (
              <AgentActivity
                correlationId={generation.id}
                label={status}
                status={activity.status}
                action={
                  <IconButton
                    label={stopLabel}
                    variant="ghost-muted"
                    disabled={stop.isPending}
                    onClick={() => void stop.mutate({ requestId: generation.id }).catch(() => {})}
                  >
                    <CancelIcon aria-hidden="true" />
                  </IconButton>
                }
              />
            )}
            {retry.isError && (
              <ErrorState
                layout="sidebar"
                title={t('PracticeGenerationRetryError')}
                description={t('PracticeGenerationRetryErrorDescription')}
              />
            )}
          </Sidebar.WorkProgress>
        </ContextMenuTrigger>
        <ContextMenuPopup>
          <ContextMenuItem onClick={() => setDetailsOpen(true)}>
            <WorkActivityIcon aria-hidden="true" />
            {t('AgentActivityDetails')}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={stop.isPending}
            onClick={() => void stop.mutate({ requestId: generation.id }).catch(() => {})}
          >
            <StopIcon aria-hidden="true" />
            {t('PracticeGenerationStopAction')}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      <AgentActivityDetails
        correlationId={generation.id}
        title={generation.title}
        status={activity.status}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      >
        {failed && (
          <ErrorState
            title={t('PracticeGenerationFailed')}
            description={t('PracticeGenerationFailedDescription')}
          />
        )}
      </AgentActivityDetails>
      {stop.isError && (
        <Sidebar.Message role="alert">{t('PracticeGenerationStopError')}</Sidebar.Message>
      )}
    </Sidebar.NoteEntry>
  );
}

function generationActivity({
  stopping,
  failed,
  retrying
}: {
  stopping: boolean;
  failed: boolean;
  retrying: boolean;
}) {
  if (stopping) return { label: 'PracticeGenerationStopping', status: 'stopping' } as const;

  if (failed) return { label: 'AgentActivityDetails', status: 'failed' } as const;

  if (retrying) return { label: 'PracticeGenerationRetrying', status: 'waiting' } as const;

  return { label: 'PracticeGenerationRunning', status: 'running' } as const;
}
