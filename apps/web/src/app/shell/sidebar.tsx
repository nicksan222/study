import { SidebarShelf } from '#web/features/authored-documents/index.ts';
import { LibraryList } from '#web/features/library/index.ts';
import { sidebarContent } from '#web/lib/navigation/sidebar-config.ts';

import { SidebarView } from './sidebar.view';
import { useSidebar } from './use-sidebar';
import type { SidebarProps } from './use-sidebar';

export function Sidebar(props: SidebarProps) {
  const model = useSidebar(props);
  const content = sidebarContent(model.metadata);
  const ready =
    model.canSearch &&
    model.subjectState === 'ready' &&
    (!model.requestedProject || model.project !== undefined);

  return (
    <SidebarView
      {...model}
      workspaceSections={
        ready
          ? workspaceSections.map(({ key, Component }) => (
              <Component
                key={`${key}:${model.project}`}
                project={model.project}
                subjects={model.subjects}
              />
            ))
          : null
      }
      library={
        content !== 'workspace' ? (
          <LibraryList
            section={content}
            subjects={model.subjects}
            project={model.project}
            blocked={
              Boolean(model.requestedProject) && (!model.project || model.subjectState !== 'ready')
            }
            ready={model.subjectState === 'ready'}
            query={model.query}
          />
        ) : null
      }
    />
  );
}

/** Register independent workspace collections here; each feature owns its data and rows. */
const workspaceSections = [{ key: 'shelf', Component: SidebarShelf }];
