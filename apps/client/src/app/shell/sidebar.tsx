import { useParams } from '@tanstack/react-router';
import type { ComponentType } from 'react';

import { LibraryList } from '#client/features/library/index.ts';
import { PagesSidebar } from '#client/features/pages/index.ts';
import { PracticeSidebarGenerations } from '#client/features/practice/index.ts';
import type { SidebarContent } from '#client/lib/navigation/sidebar-config.ts';
import { sidebarContent } from '#client/lib/navigation/sidebar-config.ts';

import { useSidebarCounts } from './sidebar-counts.queries';
import { SidebarView } from './sidebar.view';
import { useSidebar } from './use-sidebar';
import type { SidebarProps, SidebarModel } from './use-sidebar';

type PanelProps = { model: SidebarModel; ready: boolean };

/** Each section owns its data and rendering; the shell only selects its registered panel. */
const panels: Record<SidebarContent, ComponentType<PanelProps> | null> = {
  workspace: null,
  assistant: null,
  pages: ({ model, ready }) =>
    ready ? (
      <PagesSidebar
        key={String(model.project)}
        project={model.project}
        subjects={model.subjects}
        query={model.query}
      />
    ) : null,
  practice: ({ model, ready }) => <PracticePanel model={model} ready={ready} />
};

export function Sidebar(props: SidebarProps) {
  const model = useSidebar(props);
  const { noteId } = useParams({ strict: false });
  const Panel = panels[sidebarContent(model.metadata)];
  const ready =
    model.canSearch &&
    model.subjectState === 'ready' &&
    (!model.requestedProject || model.project !== undefined);

  const counts = useSidebarCounts({
    project: model.project,
    subjects: model.subjects,
    notes: model.notes,
    notesReady: model.noteState === 'ready',
    ready
  });

  return (
    <SidebarView
      counts={counts}
      {...model}
      selectedNote={noteId ? String(noteId) : null}
      collection={Panel ? <Panel model={model} ready={ready} /> : null}
    />
  );
}

function PracticePanel({ model, ready }: PanelProps) {
  return (
    <>
      <PracticeSidebarGenerations
        key={String(model.project)}
        project={model.project}
        subjects={model.subjects}
        query={model.query}
        enabled={ready}
      />
      <LibraryList
        subjects={model.subjects}
        project={model.project}
        blocked={Boolean(model.requestedProject) && !ready}
        ready={model.subjectState === 'ready'}
        query={model.query}
      />
    </>
  );
}
