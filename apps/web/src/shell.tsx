import { Shell as PageShell } from '@study/ui/shell';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Outlet, useMatches } from '@tanstack/react-router';
import { useState } from 'react';

import { useI18n } from './i18n';
import { Sidebar } from './sidebar';

export function Shell() {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const matches = useMatches();
  const page = matches.at(-1)?.staticData.page ?? 'Home';

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
      <Sidebar page={page} collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <SidebarUI.Main>
        <SidebarUI.Topbar parent={t('AppName')} title={t(page)} />
        <PageShell.PageBody>
          <Outlet />
        </PageShell.PageBody>
      </SidebarUI.Main>
    </SidebarUI.Frame>
  );
}
