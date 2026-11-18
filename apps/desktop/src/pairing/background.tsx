import {
  desktopState,
  reportBackgroundError,
  resumeDesktop,
  setMobileBackground,
  subscribeDesktop,
  useI18n
} from '@study/client/companion';
import { useEffect, useSyncExternalStore } from 'react';

const linked = () => !!desktopState().link;

export function MobileBackground() {
  const { t } = useI18n();
  const enabled = useSyncExternalStore(subscribeDesktop, linked);

  useEffect(() => {
    void resumeDesktop().catch(reportBackgroundError);
  }, []);

  useEffect(() => {
    void setMobileBackground(enabled, t('MobileShowDesktop'), t('MobileQuitDesktop')).catch(
      reportBackgroundError
    );
  }, [enabled, t]);

  return null;
}
