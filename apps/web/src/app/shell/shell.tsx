import { Shell as PageShell } from '@study/ui/shell';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Outlet, useMatches } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { Sidebar } from './sidebar';

function useShellNavigation(sessions: boolean) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const focusSearch = useRef(false);
  useEffect(() => {
    if (!sessions || open) return;
    const revealSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      focusSearch.current = true;
      setOpen(true);
    };
    window.addEventListener('keydown', revealSearch);
    return () => window.removeEventListener('keydown', revealSearch);
  }, [sessions, open]);
  useEffect(() => {
    if (!open || !focusSearch.current) return;
    focusSearch.current = false;
    document.querySelector<HTMLInputElement>('.study-sidebar-search input')?.focus();
  }, [open]);
  return {
    visible: !sessions || open,
    collapsed: sessions ? !open : collapsed,
    open,
    toggle: () => (sessions ? setOpen((value) => !value) : setCollapsed((value) => !value))
  };
}

function ShellHeader({
  sessions,
  visible,
  title,
  onToggle
}: {
  sessions: boolean;
  visible: boolean;
  title: string;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  if (!sessions) return <SidebarUI.Topbar parent={t('AppName')} title={title} />;
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      {!visible && (
        <SidebarUI.Toggle
          className="study-entry-navigation-toggle"
          label={t('ToggleSidebar')}
          expanded={false}
          onClick={onToggle}
        />
      )}
    </>
  );
}

export function Shell() {
  const { t } = useI18n();
  const matches = useMatches();
  const metadata = matches.at(-1)?.staticData ?? {};
  const title = metadata.title ?? 'Home';
  const sessions = title === 'Sessions';
  const navigation = useShellNavigation(sessions);
  return (
    <SidebarUI.Frame
      className={sessions ? 'study-shell-session-entry' : undefined}
      data-entry-navigation={navigation.open}
      collapsed={navigation.collapsed}
      defaultWidth={288}
      minWidth={224}
      minContentWidth={360}
      storageKey="study-sidebar-width"
      resizeLabel={t('ResizeSidebar')}
      resizeHint={t('ResizeSidebarHint')}
    >
      {navigation.visible && (
        <Sidebar
          metadata={{
            title,
            section: metadata.section ?? 'sessions',
            scope: metadata.scope ?? 'project'
          }}
          collapsed={navigation.collapsed}
          onToggle={navigation.toggle}
        />
      )}
      <SidebarUI.Main>
        <ShellHeader
          sessions={sessions}
          visible={navigation.visible}
          title={t(title)}
          onToggle={navigation.toggle}
        />
        <PageShell.PageBody layout={sessions ? 'bleed' : 'padded'}>
          <Outlet />
        </PageShell.PageBody>
      </SidebarUI.Main>
    </SidebarUI.Frame>
  );
}
