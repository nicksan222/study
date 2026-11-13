import type { ProjectId } from '@study/contracts/ids';
import type { materialGenerationSnapshotSchema } from '@study/contracts/materials/schemas';
import { AiActivity } from '@study/ui/ai-button';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem
} from '@study/ui/context-menu';
import { Sidebar } from '@study/ui/sidebar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Layers, Square } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import type { Subjects } from '#client/lib/study-client/operations.ts';

import { activeGenerationsOptions, cancelGenerationOptions } from './quiz-generation.queries';

type Generation = typeof materialGenerationSnapshotSchema.Type;

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
  const cache = useQueryClient();
  const state = useQuery(activeGenerationsOptions(project, enabled));
  const previous = useRef<readonly Generation[]>([]);

  useEffect(() => {
    if (!enabled || !state.data) return;

    if (previous.current.some((item) => !state.data.some((next) => next.id === item.id))) {
      void cache.invalidateQueries({ queryKey: ['library', 'practice'] });
      void cache.invalidateQueries({ queryKey: ['materials', 'detail'] });
    }

    previous.current = state.data;
  }, [cache, state.data, enabled]);

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
  const cache = useQueryClient();
  const stop = useMutation({
    ...cancelGenerationOptions(generation.id),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['materials'] });
      void cache.invalidateQueries({ queryKey: ['library', 'practice'] });
    }
  });
  const owner = subjects.find((subject) => subject.id === generation.projectId);
  const Icon = generation.kind === 'flashcards' ? Layers : GraduationCap;
  const stopLabel = t('PracticeGenerationStop', { title: generation.title });
  const status = t(stop.isPending ? 'PracticeGenerationStopping' : 'PracticeGenerationRunning');

  return (
    <Sidebar.NoteEntry>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <Sidebar.Item
              label={generation.title}
              context={
                owner?.name ?? t(generation.kind === 'flashcards' ? 'Flashcards' : 'SidebarQuiz')
              }
              icon={<Icon aria-hidden="true" />}
              description={
                <Sidebar.NoteActivity running>
                  <AiActivity label={status} state={stop.isPending ? 'stopping' : 'running'} />
                </Sidebar.NoteActivity>
              }
              aria-label={generation.title}
              title={generation.title}
              render={<div />}
            />
          }
        />
        <ContextMenuPopup>
          <ContextMenuItem disabled={stop.isPending} onClick={() => stop.mutate()}>
            <Square aria-hidden="true" />
            {t('PracticeGenerationStopAction')}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      <Sidebar.NoteRowActions>
        <Sidebar.SettleAction
          aria-label={stopLabel}
          title={stopLabel}
          disabled={stop.isPending}
          onClick={() => stop.mutate()}
        >
          <Square aria-hidden="true" />
          {t('StopJob')}
        </Sidebar.SettleAction>
      </Sidebar.NoteRowActions>
      {stop.isError && (
        <Sidebar.Message role="alert">{t('PracticeGenerationStopError')}</Sidebar.Message>
      )}
    </Sidebar.NoteEntry>
  );
}
