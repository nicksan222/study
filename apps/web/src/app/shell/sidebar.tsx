import { LibraryList } from '../../features/library';
import { SidebarView } from './sidebar.view';
import { useSidebar } from './use-sidebar';
import type { SidebarProps } from './use-sidebar';

export function Sidebar(props: SidebarProps) {
  const model = useSidebar(props);

  return (
    <SidebarView
      {...model}
      library={
        model.section === 'library' || model.section === 'practice' ? (
          <LibraryList
            section={model.section}
            subjects={model.subjects}
            project={model.project}
            blocked={
              Boolean(model.requestedProject) && (!model.project || model.subjectState !== 'ready')
            }
            ready={model.subjectState === 'ready'}
            query={model.query}
            filter={model.filter}
          />
        ) : null
      }
    />
  );
}
