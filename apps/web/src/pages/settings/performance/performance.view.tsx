import { RetryButton } from '@study/ui/action-button';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';

import { useI18n } from '#web/lib/i18n.tsx';

import type { usePerformanceSettings } from './use-performance';

export function PerformanceSettingsView({
  model
}: {
  model: ReturnType<typeof usePerformanceSettings>;
}) {
  const { t } = useI18n();
  const rows = [
    {
      key: 'active',
      title: 'PerformanceSettingsParallel',
      description: 'PerformanceSettingsParallelDescription',
      validation: 'PerformanceSettingsParallelValidation'
    },
    {
      key: 'queued',
      title: 'PerformanceSettingsQueue',
      description: 'PerformanceSettingsQueueDescription',
      validation: 'PerformanceSettingsQueueValidation'
    }
  ] as const;

  return (
    <Settings.Section title={t('PerformanceSettingsTitle')}>
      {model.error && (
        <Settings.Status
          action={
            <RetryButton variant="outline" size="sm" onClick={model.retry} label={t('Retry')} />
          }
        >
          {t('PerformanceSettingsError')}
        </Settings.Status>
      )}
      {model.loading && !model.error && <Loading label={t('LoadingSettings')} layout="panel" />}
      {model.data && (
        <Settings.Group>
          {rows.map((row) => {
            const control = model[row.key];

            return (
              <Settings.NumberRow
                key={row.key}
                title={t(row.title)}
                description={t(row.description)}
                min={control.min}
                max={control.max}
                value={control.value}
                disabled={model.pending}
                submitDisabled={!control.valid || !control.changed}
                error={control.valid ? undefined : t(row.validation)}
                onValueChange={control.setValue}
                onSubmit={control.save}
                submitLabel={t(model.pending ? 'Saving' : 'Save')}
              />
            );
          })}
        </Settings.Group>
      )}
    </Settings.Section>
  );
}
