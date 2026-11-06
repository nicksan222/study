import { RetryButton } from '@study/ui/action-button';
import { Loading } from '@study/ui/loading';
import { NumberControl } from '@study/ui/number-control';
import { Settings } from '@study/ui/settings';

import { useI18n } from '#web/lib/i18n.tsx';

import type { useStudySettings } from './use-study';

export function StudySettingsView({ model }: { model: ReturnType<typeof useStudySettings> }) {
  const { t } = useI18n();

  return (
    <Settings.Section title={t('StudySettingsTitle')}>
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
          <Settings.Row
            title={t('StudySettingsNewCards')}
            description={t('StudySettingsNewCardsDescription')}
          >
            <NumberControl
              label={t('StudySettingsNewCards')}
              min={0}
              max={10000}
              value={model.draft}
              disabled={model.pending}
              submitDisabled={!model.valid || !model.changed}
              error={model.valid ? undefined : t('StudySettingsNewCardsValidation')}
              onValueChange={model.setDraft}
              onSubmit={model.save}
              submitLabel={t(model.pending ? 'Saving' : 'Save')}
            />
          </Settings.Row>
        </Settings.Group>
      )}
    </Settings.Section>
  );
}
