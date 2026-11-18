import type { VoiceSettings as Preferences } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { RetryButton, Loading, Settings } from '@study/ui';

import { VoiceLanguageRow, VoiceModelControls } from '#client/features/voice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { useSettingsPatchAutosave } from '#client/lib/settings-autosave.ts';

export function VoiceSettings() {
  const { t } = useI18n();
  const preferences = rpc.settings.voiceSettings.useQuery({});
  const write = rpc.settings.saveVoiceSettings.useMutation();
  const save = useSettingsPatchAutosave<Preferences>(write.mutateAsync);
  const disabled = save.pending || !preferences.data;

  return (
    <>
      <Settings.Section title={t('VoiceTitle')} busy={save.pending}>
        <Settings.Intro>{t('VoicePrivacy')}</Settings.Intro>
        <Settings.Group>
          <VoiceLanguageRow />
          <ChunkDuration
            current={preferences.data?.chunkSeconds ?? 30}
            disabled={disabled}
            onChange={(chunkSeconds) => save.update({ chunkSeconds })}
          />
          <Settings.ToggleRow
            title={t('VoiceDenoise')}
            description={t('VoiceDenoiseHelp')}
            checked={preferences.data?.denoise ?? false}
            disabled={disabled}
            onCheckedChange={(denoise) => save.update({ denoise })}
          />
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
        <VoiceSettingsError
          loadFailed={preferences.isError}
          saveFailed={save.error}
          onRetry={() => {
            save.retry();
            preferences.refetch();
          }}
        />
      </Settings.Section>
      <Settings.Section>
        <VoiceModelControls layout="settings" />
      </Settings.Section>
    </>
  );
}

function VoiceSettingsError({
  loadFailed,
  saveFailed,
  onRetry
}: {
  loadFailed: boolean;
  saveFailed: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();

  if (!loadFailed && !saveFailed) return null;

  return (
    <Settings.Status
      action={<RetryButton label={t('Retry')} variant="outline" size="sm" onClick={onRetry} />}
    >
      {t(saveFailed ? 'SettingsSaveFailed' : 'VoiceSettingsLoadFailed')}
    </Settings.Status>
  );
}

type ChunkSeconds = NonNullable<Preferences['chunkSeconds']>;

function ChunkDuration({
  current,
  disabled,
  onChange
}: {
  current: ChunkSeconds;
  disabled: boolean;
  onChange: (seconds: ChunkSeconds) => void;
}) {
  const { t } = useI18n();

  return (
    <Settings.SelectRow
      title={t('VoiceChunkDuration')}
      description={t('VoiceChunkDurationHelp')}
      value={String(current)}
      disabled={disabled}
      options={[10, 20, 30].map((seconds) => ({
        value: String(seconds),
        label: t('VoiceChunkSeconds', { seconds })
      }))}
      onValueChange={(value) => {
        const seconds = Number(value);

        if (seconds === 10 || seconds === 20 || seconds === 30) onChange(seconds);
      }}
    />
  );
}
