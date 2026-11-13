import { Language } from '@study/contracts/settings/types';
import { RetryButton } from '@study/ui/action-button';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';

import { ReplayOnboarding } from '#client/features/onboarding/index.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import type { useGeneralSettings } from './use-general';

export function GeneralSettingsView({
  model,
  showReplay = true
}: {
  model: ReturnType<typeof useGeneralSettings>;
  showReplay?: boolean;
}) {
  const { t } = useI18n();

  return (
    <Settings.Section title={showReplay ? t('GeneralSettingsTitle') : undefined}>
      {model.error && (
        <Settings.Status
          action={
            <RetryButton variant="outline" size="sm" onClick={model.retry} label={t('Retry')} />
          }
        >
          {t('GeneralSettingsError')}
        </Settings.Status>
      )}
      {model.loading && !model.error && <Loading label={t('LoadingSettings')} layout="panel" />}
      {model.data && (
        <Settings.Group>
          <Settings.SelectRow
            title={t('GeneralSettingsLanguage')}
            description={
              showReplay
                ? `${t('GeneralSettingsLanguageDescription')} ${t('GeneralSettingsLocalPreferences')}`
                : undefined
            }
            value={model.data.language === Language.ITALIAN ? 'italian' : 'english'}
            options={[
              { value: 'english', label: t('EnglishOwnName') },
              { value: 'italian', label: t('ItalianOwnName') }
            ]}
            onValueChange={model.setLanguage}
            disabled={model.pending}
          />
          {showReplay && <ReplayOnboarding />}
        </Settings.Group>
      )}
      {model.pending && <Loading label={t('Saving')} />}
    </Settings.Section>
  );
}
