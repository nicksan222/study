import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';

import { useI18n } from '#web/lib/i18n.tsx';

import type { AppearanceModel } from './use-page';

/** Shares appearance loading and recovery feedback between settings and onboarding. */
export function AppearanceStatus({ model }: { model: AppearanceModel }) {
  const { t } = useI18n();

  return (
    <>
      {model.loading && <Loading label={t('LoadingSettings')} />}
      {model.error && (
        <Settings.Status
          action={
            <Button variant="outline" onClick={model.retry}>
              {t('Retry')}
            </Button>
          }
        >
          {t('AppearanceFailed')}
        </Settings.Status>
      )}
    </>
  );
}
