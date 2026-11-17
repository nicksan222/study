import { rpc } from '@study/contracts/react';
import { RetryButton, Loading, Settings } from '@study/ui';

import { VoiceModelControls } from '#client/features/voice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { useSettingsAutosave } from '#client/lib/settings-autosave.ts';

export function VoiceSettings() {
  const { t } = useI18n();
  const preferences = rpc.settings.voiceSettings.useQuery({});
  const write = rpc.settings.saveVoiceSettings.useMutation();
  const save = useSettingsAutosave(() => rpc.settings.voiceSettings.read({}), write.mutateAsync);

  return (
    <Settings.Section title={t('VoiceTitle')} busy={save.pending}>
      <VoiceModelControls />
      <Settings.Group>
        <Settings.Row title={t('VoiceLanguage')} description={t('VoiceLanguages')}>
          {t('VoiceAutomatic')}
        </Settings.Row>
        {preferences.isPending && <Loading label={t('LoadingSettings')} />}
        {preferences.data && (
          <Settings.ToggleRow
            title={t('VoiceFilterSilence')}
            description={t('VoiceFilterSilenceHelp')}
            checked={preferences.data.filterSilence}
            disabled={save.pending}
            onCheckedChange={(filterSilence) => save.update({ filterSilence })}
          />
        )}
      </Settings.Group>
      {(save.error || preferences.isError) && (
        <Settings.Status
          action={
            <RetryButton
              label={t('Retry')}
              variant="outline"
              size="sm"
              onClick={() => {
                save.retry();
                preferences.refetch();
              }}
            />
          }
        >
          {t('SettingsSaveFailed')}
        </Settings.Status>
      )}
      <Settings.Feedback>{t('VoicePrivacy')}</Settings.Feedback>
      <Settings.Feedback>{t('VoiceRecordingHelp')}</Settings.Feedback>
    </Settings.Section>
  );
}
