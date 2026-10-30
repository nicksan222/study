import { Shell as PageShell } from '@study/ui/shell';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Outlet, useMatches } from '@tanstack/react-router';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { Sidebar } from './sidebar';

export function Shell() {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const matches = useMatches();
  const metadata = matches.at(-1)?.staticData;
  const title = metadata?.title ?? 'Home';

  return (
    <SidebarUI.Frame
      collapsed={collapsed}
      defaultWidth={320}
      minWidth={256}
      minContentWidth={360}
      storageKey="study-sidebar-width"
      resizeLabel={t('ResizeSidebar')}
      resizeHint={t('ResizeSidebarHint')}
    >
      <Sidebar
        metadata={{
          title,
          section: metadata?.section ?? 'sessions',
          scope: metadata?.scope ?? 'project'
        }}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />
      <SidebarUI.Main>
        <SidebarUI.Topbar parent={t('AppName')} title={t(title)} />
        <PageShell.PageBody>
          <Outlet />
        </PageShell.PageBody>
      </SidebarUI.Main>
    </SidebarUI.Frame>
  );
}
