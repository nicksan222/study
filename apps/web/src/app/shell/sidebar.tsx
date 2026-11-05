import { useParams } from '@tanstack/react-router';
import type { ComponentType } from 'react';

import { DocumentsSidebar } from '#web/features/authored-documents/index.ts';
import { LibraryList } from '#web/features/library/index.ts';
import type { SidebarContent } from '#web/lib/navigation/sidebar-config.ts';
import { sidebarContent } from '#web/lib/navigation/sidebar-config.ts';

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
  library: ({ model, ready }) => <LibraryPanel model={model} ready={ready} section="library" />,
  practice: ({ model, ready }) => <LibraryPanel model={model} ready={ready} section="practice" />
};

export function Sidebar(props: SidebarProps) {
  const model = useSidebar(props);
  const { sessionId } = useParams({ strict: false });
  const Panel = panels[sidebarContent(model.metadata)];
  const ready =
    model.canSearch &&
    model.subjectState === 'ready' &&
    (!model.requestedProject || model.project !== undefined);

  return (
    <SidebarView
      {...model}
      selectedSession={sessionId ? String(sessionId) : null}
      collection={Panel ? <Panel model={model} ready={ready} /> : null}
    />
  );
}

function LibraryPanel({ model, ready, section }: PanelProps & { section: 'library' | 'practice' }) {
  return (
    <LibraryList
      section={section}
      subjects={model.subjects}
      project={model.project}
      blocked={Boolean(model.requestedProject) && !ready}
      ready={model.subjectState === 'ready'}
      query={model.query}
    />
  );
}
