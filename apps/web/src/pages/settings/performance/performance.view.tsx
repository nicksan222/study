import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { NumberControl } from '@study/ui/number-control';
import { Settings } from '@study/ui/settings';

import { useI18n } from '../../../lib/i18n';
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
            <Button variant="outline" size="sm" onClick={model.retry}>
              {t('Retry')}
            </Button>
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
              <Settings.Row key={row.key} title={t(row.title)} description={t(row.description)}>
                <NumberControl
                  label={t(row.title)}
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
              </Settings.Row>
            );
          })}
        </Settings.Group>
      )}
    </Settings.Section>
  );
}
