import { useI18n } from '@study/client/companion';
import { Button } from '@study/ui';
import { useContext } from 'react';

import { UnlinkPhone } from './session';

export function UnlinkAction({ busy }: { busy?: boolean }) {
  const { t } = useI18n();
  const unlink = useContext(UnlinkPhone);

  return (
    <div>
      <Button variant="outline" disabled={busy} onClick={unlink}>
        {t('MobileUnlink')}
      </Button>
    </div>
  );
}
