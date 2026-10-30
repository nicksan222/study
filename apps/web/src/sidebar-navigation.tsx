import { Sidebar } from '@study/ui/sidebar';
import { Link } from '@tanstack/react-router';
import { MessagesSquare, Library, GraduationCap, Activity, Settings } from 'lucide-react';

import { useI18n } from './i18n';
import type { PageName } from './navigation';

const sections = [
  ['Sessions', MessagesSquare, 'Sessions'],
  ['MediaList', Library, 'SidebarLibrary'],
  ['Practice', GraduationCap, 'Practice'],
  ['Pipelines', Activity, 'Pipelines']
] as const;

const sectionPages: Record<(typeof sections)[number][0], readonly PageName[]> = {
  Sessions: ['Sessions', 'Home'],
  MediaList: ['MediaList', 'Diagrams'],
  Practice: ['Practice', 'Flashcards'],
  Pipelines: ['Pipelines']
};

export function SidebarNavigation({
  page,
  project,
  onNavigate
}: {
  page: PageName;
  project: string | null;
  onNavigate: () => void;
}) {
  const { t } = useI18n();

  return (
    <Sidebar.Footer
      id="study-sidebar-navigation"
      aria-label={t('SidebarNavigation')}
      trailing={
        <Sidebar.Utility
          variant={page === 'Settings' ? 'secondary' : 'ghost-muted'}
          title={t('Settings')}
          render={
            <Link
              to="/Settings"
              search={project ? { project } : {}}
              aria-label={t('Settings')}
              aria-current={page === 'Settings' ? 'page' : undefined}
              onClick={onNavigate}
            />
          }
        >
          <Settings aria-hidden="true" />
        </Sidebar.Utility>
      }
    >
      {sections.map(([destination, Icon, label]) => (
        <Sidebar.Utility
          key={destination}
          title={t(label)}
          variant="ghost-muted"
          render={
            <Link
              to={`/${destination}`}
              search={project ? { project } : {}}
              aria-label={t(label)}
              aria-current={sectionPages[destination].includes(page) ? 'page' : undefined}
              onClick={onNavigate}
            />
          }
        >
          <Icon aria-hidden="true" />
        </Sidebar.Utility>
      ))}
    </Sidebar.Footer>
  );
}
