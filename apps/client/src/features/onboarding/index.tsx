import { StartIcon } from '@study/icons';
import { Button, Settings } from '@study/ui';
import { createContext, useContext } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

export const ReplayContext = createContext<(() => void) | null>(null);

export function ReplayOnboarding() {
  const replay = useContext(ReplayContext);
  const { t } = useI18n();

  return (
    <Settings.Row
      title={t('OnboardingWelcomeTitle')}
      description={t('OnboardingReplayDescription')}
    >
      <Button variant="outline" onClick={() => replay?.()} disabled={!replay}>
        <StartIcon aria-hidden="true" />
        {t('ReplayOnboarding')}
      </Button>
    </Settings.Row>
  );
}
