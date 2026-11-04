import { Language } from '@study/contracts/settings/types';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { SelectControl } from '@study/ui/select-control';
import { Settings } from '@study/ui/settings';

import { useI18n } from '#web/lib/i18n.tsx';

import type { useGeneralSettings } from './use-general';

export function GeneralSettingsView({ model }: { model: ReturnType<typeof useGeneralSettings> }) {
  const { t } = useI18n();

  return (
    <Settings.Section title={t('GeneralSettingsTitle')}>
      {model.error && (
        <Settings.Status
          action={
            <Button variant="outline" size="sm" onClick={model.retry}>
              {t('Retry')}
            </Button>
          }
        >
          {t('GeneralSettingsError')}
        </Settings.Status>
      )}
      {model.loading && !model.error && <Loading label={t('LoadingSettings')} layout="panel" />}
      {model.data && (
        <Settings.Group>
          <Settings.Row
            title={t('GeneralSettingsLanguage')}
            description={`${t('GeneralSettingsLanguageDescription')} ${t('GeneralSettingsLocalPreferences')}`}
          >
            <SelectControl
              label={t('GeneralSettingsLanguage')}
              value={model.data.language === Language.ITALIAN ? 'italian' : 'english'}
              options={[
                { value: 'english', label: t('EnglishOwnName') },
                { value: 'italian', label: t('ItalianOwnName') }
              ]}
              onValueChange={model.setLanguage}
              disabled={model.pending}
            />
          </Settings.Row>
        </Settings.Group>
      )}
      {model.pending && <Loading label={t('Saving')} />}
    </Settings.Section>
  );
}
