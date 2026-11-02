import { Sidebar } from '@study/ui/sidebar';
import { Link } from '@tanstack/react-router';
import { MessagesSquare, Library, GraduationCap, Activity } from 'lucide-react';

import { useI18n } from '../../lib/i18n';
import type { Section } from '../../lib/navigation/route-contract';
import { SettingsMenu } from '../../pages/settings/menu';

const sections = [
  ['/sessions', 'sessions', MessagesSquare, 'Sessions'],
  ['/library', 'library', Library, 'SidebarLibrary'],
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
    <>
      <Sidebar.Navigation id="study-sidebar-navigation" aria-label={t('SidebarNavigation')}>
        {sections.map(([to, currentSection, Icon, label]) => (
          <Sidebar.NavigationItem
            key={to}
            label={t(label)}
            render={
              <Link
                to={to}
                search={project ? { project } : {}}
                aria-current={!settings && section === currentSection ? 'page' : undefined}
                onClick={onNavigate}
              />
            }
          >
            <Icon aria-hidden="true" />
          </Sidebar.NavigationItem>
        ))}
      </Sidebar.Navigation>
      <Sidebar.Footer aria-label={t('Settings')}>
        <SettingsMenu active={settings} onOpen={onNavigate} />
      </Sidebar.Footer>
    </>
  );
}
