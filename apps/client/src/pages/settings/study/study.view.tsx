import { RetryButton, Loading, Settings } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

import type { useStudySettings } from './use-study';

export function StudySettingsView({ model }: { model: ReturnType<typeof useStudySettings> }) {
  const { t } = useI18n();

  return (
    <Settings.Section title={t('StudySettingsTitle')} busy={model.pending}>
      {model.error && (
        <Settings.Status
          action={
            <RetryButton variant="outline" size="sm" onClick={model.retry} label={t('Retry')} />
          }
        >
          {t('StudySettingsError')}
        </Settings.Status>
      )}
      {model.loading && !model.error && <Loading label={t('LoadingSettings')} layout="panel" />}
      {model.data && (
        <Settings.Group>
          <Settings.NumberRow
            title={t('StudySettingsNewCards')}
            description={t('StudySettingsNewCardsDescription')}
            min={0}
            max={10000}
            value={model.draft}
            error={model.valid ? undefined : t('StudySettingsNewCardsValidation')}
            onValueChange={model.setDraft}
          />
        </Settings.Group>
      )}
    </Settings.Section>
  );
}
