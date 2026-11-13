import { RetryButton } from '@study/ui/action-button';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';

import { useI18n } from '#client/lib/i18n.tsx';

import type { AppearanceModel } from './use-page';

/** Shares appearance loading and recovery feedback between settings and onboarding. */
export function AppearanceStatus({ model }: { model: AppearanceModel }) {
  const { t } = useI18n();

  return (
    <>
      {model.loading && <Loading label={t('LoadingSettings')} />}
      {model.error && (
        <Settings.Status
          action={<RetryButton variant="outline" onClick={model.retry} label={t('Retry')} />}
        >
          {t('AppearanceFailed')}
        </Settings.Status>
      )}
    </>
  );
}
