import { RetryButton } from '@study/ui/action-button';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';

import { useI18n } from '#web/lib/i18n.tsx';

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
            <RetryButton
              size="sm"
              variant="outline"
              onClick={() => {
                model.mutation.reset();
                void model.query.refetch();
              }}
              label={t('Retry')}
            />
          }
        >
          {t('SidebarSettingsError')}
        </Settings.Status>
      )}
      {model.query.data && (
        <Settings.Group>
          <Settings.NumberRow
            title={t('SidebarSettledThreshold')}
            description={t('SidebarSettledDescription')}
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
        </Settings.Group>
      )}
    </Settings.Section>
  );
}
