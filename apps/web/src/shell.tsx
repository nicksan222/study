import { Button } from '@study/ui/button';
import { Shell as PageShell } from '@study/ui/shell';
import { Link, Outlet, useMatches } from '@tanstack/react-router';
import {
  Home,
  MessagesSquare,
  Library,
  Folder,
  Layers,
  Network,
  GraduationCap,
  Activity,
  Settings,
  CircleHelp
} from 'lucide-react';

import { useI18n } from './i18n';
import type { PageName } from './navigation';

const navigationItems = [
  ['Home', Home],
  ['Sessions', MessagesSquare],
  ['MediaList', Library],
  ['Projects', Folder],
  ['Flashcards', Layers],
  ['Diagrams', Network],
  ['Practice', GraduationCap],
  ['Pipelines', Activity],
  ['Settings', Settings],
  ['Help', CircleHelp]
] as const satisfies readonly (readonly [PageName, typeof Home])[];

export function Shell() {
  const { t } = useI18n();
  const matches = useMatches();
  const page = matches.at(-1)?.staticData.page ?? 'Home';

  return (
    <div className="study-shell">
      <aside className="study-sidebar">
        <span className="study-sidebar-brand">{t('AppName')}</span>
        <nav className="study-subject-nav" aria-label={t('AppName')}>
          {navigationItems.map(([name, Icon]) => (
            <Button
              key={name}
              variant={page === name ? 'secondary' : 'ghost-muted'}
              layout="navigation"
              render={<Link to={`/${name}`} search={{}} aria-label={t(name)} />}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="nav-label">{t(name)}</span>
            </Button>
          ))}
        </nav>
      </aside>
      <main className="study-content">
        <PageShell.Header title={t(page)} />
        <PageShell.PageBody>
          <Outlet />
        </PageShell.PageBody>
      </main>
    </div>
  );
}
