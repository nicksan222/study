import { useParams } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import type { ReactNode } from 'react';

import { DocumentsSidebar } from '#web/features/authored-documents/index.ts';
import { LibraryList } from '#web/features/library/index.ts';
import { PracticeSidebarGenerations } from '#web/features/practice/index.ts';
import type { SidebarContent } from '#web/lib/navigation/sidebar-config.ts';
import { sidebarContent } from '#web/lib/navigation/sidebar-config.ts';

import { useSidebarCounts } from './sidebar-counts.queries';
import { SidebarView } from './sidebar.view';
import { useSidebar } from './use-sidebar';
import type { SidebarProps, SidebarModel } from './use-sidebar';

type PanelProps = { model: SidebarModel; ready: boolean };

/** Each section owns its data and rendering; the shell only selects its registered panel. */
const panels: Record<SidebarContent, ComponentType<PanelProps> | null> = {
  workspace: null,
  documents: ({ model, ready }) =>
    ready ? (
      <DocumentsSidebar
        key={String(model.project)}
        project={model.project}
        subjects={model.subjects}
        query={model.query}
      />
    ) : null,
  practice: ({ model, ready }) => <PracticePanel model={model} ready={ready} />
};

export function Sidebar(props: SidebarProps & { chat?: ReactNode }) {
  const model = useSidebar(props);
  const { sessionId } = useParams({ strict: false });
  const Panel = panels[sidebarContent(model.metadata)];
  const ready =
    model.canSearch &&
    model.subjectState === 'ready' &&
    (!model.requestedProject || model.project !== undefined);

  const counts = useSidebarCounts({
    project: model.project,
    subjects: model.subjects,
    sessions: model.sessions,
    sessionsReady: model.sessionState === 'ready',
    ready
  });

  return (
    <SidebarView
      chat={props.chat}
      counts={counts}
      {...model}
      selectedSession={sessionId ? String(sessionId) : null}
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
