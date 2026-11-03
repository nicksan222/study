import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { NumberControl } from '@study/ui/number-control';
import { Settings } from '@study/ui/settings';

import { useI18n } from '../../../lib/i18n';
import { useSidebarSettings } from './sidebar-settings.queries';

/** Exposes the settlement threshold with bounded input and save recovery. */
export function SidebarSettings() {
  const { t } = useI18n();
  const model = useSidebarSettings();

  return (
    <Settings.Section title={t('SidebarSettingsTitle')}>
      {model.query.isPending && <Loading label={t('LoadingSettings')} />}
      {(model.query.error || model.mutation.error) && (
        <Settings.Status
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                model.mutation.reset();
                void model.query.refetch();
              }}
            >
              {t('Retry')}
            </Button>
          }
        >
          {t('SidebarSettingsError')}
        </Settings.Status>
      )}
      {model.query.data && (
        <Settings.Group>
          <Settings.Row
            title={t('SidebarSettledThreshold')}
            description={t('SidebarSettledDescription')}
          >
            <NumberControl
              label={t('SidebarSettledThreshold')}
              min={1}
              max={100}
              value={model.value}
              disabled={model.mutation.isPending}
              submitDisabled={!model.valid || !model.changed}
              onValueChange={model.setDraft}
              onSubmit={model.save}
              submitLabel={t(model.mutation.isPending ? 'Saving' : 'Save')}
              error={model.valid ? undefined : t('SidebarSettledValidation')}
            />
          </Settings.Row>
        </Settings.Group>
      )}
    </Settings.Section>
  );
}
