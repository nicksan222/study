import type { ProjectId, materialGenerationSnapshotSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import {
  QuizIcon,
  FlashcardsIcon,
  StopIcon,
  WorkActivityIcon,
  CancelIcon,
  RetryIcon
} from '@study/icons';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ErrorState,
  IconButton,
  Sidebar
} from '@study/ui';
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
  const status = t(generationLabel(activity.label, stop.isError, retry.isError));
  const controls = (
    <>
      {failed && (
        <IconButton
          label={t('Retry')}
          variant="ghost-muted"
          size="icon-tiny"
          disabled={stop.isPending}
          onClick={() => {
            stop.reset();
            retry.retry();
          }}
        >
          <RetryIcon aria-hidden="true" />
        </IconButton>
      )}
      <IconButton
        label={stopLabel}
        variant="ghost-muted"
        size="icon-tiny"
        disabled={stop.isPending}
        onClick={() => void stop.mutate({ requestId: generation.id }).catch(() => {})}
      >
        <CancelIcon aria-hidden="true" />
      </IconButton>
    </>
  );

  return (
    <Sidebar.NoteEntry>
      <ContextMenu>
        <ContextMenuTrigger render={<div />}>
          <Sidebar.Item
            label={generation.title}
            activity={
              activity.status === 'failed' || stop.isError || retry.isError
                ? 'attention'
                : activity.status
            }
            context={owner?.name ?? t(label)}
            icon={<Icon aria-hidden="true" />}
            description={
              <AgentActivity
                correlationId={generation.id}
                label={status}
                status={stop.isError || retry.isError ? 'failed' : activity.status}
                action={controls}
              />
            }
            title={generation.title}
            render={<div />}
          />
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
        <GenerationFailureDetails failed={failed} retry={retry.isError} stop={stop.isError} />
      </AgentActivityDetails>
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

  if (failed) return { label: 'PracticeGenerationFailedStatus', status: 'failed' } as const;

  if (retrying) return { label: 'PracticeGenerationRetrying', status: 'waiting' } as const;

  return { label: 'PracticeGenerationRunning', status: 'running' } as const;
}

function generationLabel(
  label: ReturnType<typeof generationActivity>['label'],
  stop: boolean,
  retry: boolean
) {
  if (stop) return 'PracticeGenerationStopStatus';

  if (retry) return 'PracticeGenerationRetryStatus';

  return label;
}

function GenerationFailureDetails({
  failed,
  retry,
  stop
}: {
  failed: boolean;
  retry: boolean;
  stop: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      {failed && (
        <ErrorState
          layout="compact"
          title={t('PracticeGenerationFailed')}
          description={t('PracticeGenerationFailedDescription')}
        />
      )}
      {retry && (
        <ErrorState
          layout="compact"
          title={t('PracticeGenerationRetryError')}
          description={t('PracticeGenerationRetryErrorDescription')}
        />
      )}
      {stop && <ErrorState layout="compact" title={t('PracticeGenerationStopError')} />}
    </>
  );
}
