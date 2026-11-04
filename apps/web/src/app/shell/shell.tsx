import { Shell as PageShell } from '@study/ui/shell';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Outlet, useMatches } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { Sidebar } from './sidebar';

/** Owns sidebar visibility and transfers keyboard search focus when the session navigation opens. */
function useShellNavigation(sessions: boolean) {
  const [open, setOpen] = useState(true);
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
    collapsed: !open,
    open,
    toggle: () => setOpen((value) => !value)
  };
}

/** Keeps a page heading accessible when the session layout hides its visual top bar. */
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
      <SidebarUI.ScreenReaderHeading>{title}</SidebarUI.ScreenReaderHeading>
      {!visible && (
        <SidebarUI.Toggle
          placement="reveal"
          label={t('ToggleSidebar')}
          expanded={false}
          onClick={onToggle}
        />
      )}
    </>
  );
}

/** Selects the session layout from route metadata and composes the shared application shell. */
export function Shell() {
  const { t } = useI18n();
  const matches = useMatches();
  const metadata = matches.at(-1)?.staticData ?? {};
  const title = metadata.title ?? 'Home';
  const sessions = title === 'Sessions';
  const navigation = useShellNavigation(sessions);

  return (
    <SidebarUI.Frame
      variant={sessions ? 'session-entry' : 'default'}
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
