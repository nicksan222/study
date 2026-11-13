import { Button } from '@study/ui/button';
import { Settings } from '@study/ui/settings';
import { Play } from 'lucide-react';
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
        <Play aria-hidden="true" />
        {t('ReplayOnboarding')}
      </Button>
    </Settings.Row>
  );
}
