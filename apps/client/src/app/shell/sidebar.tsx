import { useParams } from '@tanstack/react-router';
import type { ComponentType, Ref } from 'react';

import { LibraryList } from '#client/features/library/index.ts';
import { PagesSidebar } from '#client/features/pages/index.ts';
import { PracticeSidebarGenerations } from '#client/features/practice/index.ts';
import { UploadedMaterialsSidebar } from '#client/features/source-library/index.ts';
import type { SidebarContent } from '#client/lib/navigation/sidebar-config.ts';
import { sidebarContent } from '#client/lib/navigation/sidebar-config.ts';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { useSidebarCounts } from './sidebar-counts.queries';
import { SidebarView } from './sidebar.view';
import { useSidebar } from './use-sidebar';
import type { SidebarProps, SidebarModel } from './use-sidebar';

type PanelProps = { model: SidebarModel; ready: boolean };

/** Each section owns its data and rendering; the shell only selects its registered panel. */
const panels: Record<SidebarContent, ComponentType<PanelProps> | null> = {
  workspace: null,
  assistant: null,
  uploads: ({ model, ready }) =>
    ready ? (
      <UploadedMaterialsSidebar
        key={String(model.project)}
        project={model.project ?? null}
        query={model.query}
        onReselect={model.onToggle}
      />
    ) : null,
  practice: ({ model, ready }) => <PracticePanel model={model} ready={ready} />
};

export function Sidebar({
  toggleRef,
  primary,
  ...props
}: SidebarProps & { toggleRef?: Ref<HTMLButtonElement>; primary?: boolean }) {
  const model = useSidebar(props);
  const { sidebarCompactNavigation } = useWorkspacePreferences();
  const { noteId } = useParams({ strict: false });
  const Panel = panels[sidebarContent(model.metadata)];
  const ready =
    model.canSearch &&
    model.subjectState === 'ready' &&
    (!model.requestedProject || model.project !== undefined);

  const counts = useSidebarCounts({
    project: model.project,
    notesReady: model.noteState === 'ready',
    ready
  });

  return (
    <SidebarView
      counts={counts}
      compactNavigation={sidebarCompactNavigation}
      {...model}
      hidden={props.hidden}
      primary={primary}
      toggleRef={toggleRef}
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
      {ready && (
        <PagesSidebar
          key={`study-notes:${model.project}`}
          project={model.project}
          subjects={model.subjects}
          query={model.query}
        />
      )}
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
