import type { ProjectId } from '@study/contracts';
import { SettingsIcon } from '@study/icons';
import { Sidebar } from '@study/ui';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { Page } from './page';

/** Opens settings without leaving the workspace and preserves its resolved subject ownership. */
export function SettingsMenu({
  active,
  onOpen,
  workspaceProject
}: {
  active: boolean;
  onOpen: () => void;
  workspaceProject?: ProjectId;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Sidebar.NavigationItem
        label={t('Settings')}
        aria-current={active ? 'page' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          onOpen();
          setOpen(true);
        }}
      >
        <SettingsIcon aria-hidden="true" />
      </Sidebar.NavigationItem>
      {open && <Page workspaceProject={workspaceProject} onClose={() => setOpen(false)} />}
    </>
  );
}
