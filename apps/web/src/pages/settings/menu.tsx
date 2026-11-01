import { Sidebar } from '@study/ui/sidebar';
import { Settings } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { Page } from './page';

export function SettingsMenu({ active, onOpen }: { active: boolean; onOpen: () => void }) {
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
        <Settings aria-hidden="true" />
      </Sidebar.NavigationItem>
      {open && <Page onClose={() => setOpen(false)} />}
    </>
  );
}
