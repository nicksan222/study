import type { ProjectId } from '@study/contracts/ids';
import { Sidebar } from '@study/ui/sidebar';
import { Link } from '@tanstack/react-router';
import { MessagesSquare, FileText, GraduationCap } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';
import type { Section } from '#web/lib/navigation/route-contract.ts';
import { SettingsMenu } from '#web/pages/settings/menu.tsx';

import type { useSidebarCounts } from './sidebar-counts.queries';

const sections = [
  ['/sessions', 'sessions', MessagesSquare, 'Sessions'],
  ['/documents', 'documents', FileText, 'SourceDocument'],
  ['/practice', 'practice', GraduationCap, 'Practice']
] as const;

/** Preserves subject scope in section links and passes resolved workspace ownership into settings. */
export function SidebarNavigation({
  section,
  settings,
  project,
  workspaceProject,
  onNavigate,
  counts
}: {
  counts?: ReturnType<typeof useSidebarCounts>;
  section: Section;
  settings: boolean;
  project: string | null;
  workspaceProject?: ProjectId;
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
            count={counts?.[currentSection].count}
            unresolved={currentSection === 'sessions' && counts?.sessions.unresolved}
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
        <SettingsMenu active={settings} onOpen={onNavigate} workspaceProject={workspaceProject} />
      </Sidebar.Footer>
    </>
  );
}
