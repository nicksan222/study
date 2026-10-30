import { Sidebar } from '@study/ui/sidebar';
import { Link } from '@tanstack/react-router';
import { MessagesSquare, Library, GraduationCap, Activity, Settings } from 'lucide-react';

import { useI18n } from '../../lib/i18n';
import type { Section } from '../../lib/navigation/route-contract';

const sections = [
  ['/sessions', 'sessions', MessagesSquare, 'Sessions'],
  ['/media-list', 'library', Library, 'SidebarLibrary'],
  ['/practice', 'practice', GraduationCap, 'Practice'],
  ['/pipelines', 'pipelines', Activity, 'Pipelines']
] as const;

export function SidebarNavigation({
  section,
  settings,
  project,
  onNavigate
}: {
  section: Section;
  settings: boolean;
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
          variant={settings ? 'secondary' : 'ghost-muted'}
          title={t('Settings')}
          render={
            <Link
              to="/settings"
              search={project ? { project } : {}}
              aria-label={t('Settings')}
              onClick={onNavigate}
            />
          }
        >
          <Settings aria-hidden="true" />
        </Sidebar.Utility>
      }
    >
      {sections.map(([to, currentSection, Icon, label]) => (
        <Sidebar.Utility
          key={to}
          title={t(label)}
          variant="ghost-muted"
          render={
            <Link
              to={to}
              search={project ? { project } : {}}
              aria-label={t(label)}
              aria-current={!settings && section === currentSection ? 'page' : undefined}
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
