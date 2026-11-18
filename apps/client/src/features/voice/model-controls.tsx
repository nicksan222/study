import { failureSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button, RetryButton, Loading, Settings } from '@study/ui';
import { Schema } from 'effect';

import { useI18n } from '#client/lib/i18n.tsx';

type VoiceStatus = ReturnType<typeof rpc.voice.status.useQuery>['data'];

function activeModel(status: VoiceStatus) {
  return status?.models.find((model) => model.id === status.modelId);
}

function useModelControls() {
  const status = rpc.voice.status.useQuery({});
  const install = rpc.voice.install.useMutation();
  const cancel = rpc.voice.cancelInstall.useMutation();
  const remove = rpc.voice.remove.useMutation();
  const state = status.data?.state;
  const busy = cancel.isPending || remove.isPending;
  const cancelled = Schema.is(failureSchema)(install.error) && install.error.kind === 'cancelled';
  const error =
    status.isError || (install.isError && !cancelled) || cancel.isError || remove.isError;

  return { status, install, cancel, remove, state, busy, error };
}

const stateLabels = {
  ready: 'VoiceModelReady',
  downloading: 'VoiceModelDownloading',
  missing: 'VoiceModelMissing'
} as const;

type ModelControls = ReturnType<typeof useModelControls>;

export function VoiceModelControls({ layout = 'setup' }: { layout?: 'setup' | 'settings' }) {
  const controls = useModelControls();
  const { t } = useI18n();
  const model = activeModel(controls.status.data);
  const downloadSize = useDownloadSize(controls);
  const stateLabel = controls.state && t(stateLabels[controls.state]);
  const actions = controls.state && (
    <Settings.Actions>
      <ModelAction controls={controls} />
    </Settings.Actions>
  );
  const feedback = <ModelFeedback controls={controls} />;

  if (layout === 'settings') {
    return (
      <>
        <ModelSettingsRow
          title={model?.name ?? t('VoiceModelTitle')}
          description={downloadSize ? [stateLabel, downloadSize].join(' ') : stateLabel}
          status={controls.status.data}
        />
        {feedback}
        {actions}
      </>
    );
  }

  return (
    <>
      <Settings.Intro>{t('VoiceModelDescription')}</Settings.Intro>
      {model && (
        <Settings.Feedback>{t('VoiceActiveModel', { model: model.name })}</Settings.Feedback>
      )}
      {feedback}
      {stateLabel && <Settings.Feedback>{stateLabel}</Settings.Feedback>}
      {downloadSize && <Settings.Feedback>{downloadSize}</Settings.Feedback>}
      <DownloadProgress status={controls.status.data} />
      {actions}
    </>
  );
}

function ModelSettingsRow({
  title,
  description,
  status
}: {
  title: string;
  description: string | undefined;
  status: VoiceStatus;
}) {
  return (
    <Settings.Group>
      <Settings.Row title={title} description={description}>
        {status?.state === 'downloading' && <DownloadProgress status={status} />}
      </Settings.Row>
    </Settings.Group>
  );
}

function useDownloadSize({ state, status }: ModelControls) {
  const { t, number } = useI18n();

  if (state !== 'missing' || status.data?.totalBytes === undefined) return undefined;

  const size = number(status.data.totalBytes / 1_000_000, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 0
  });

  return t('VoiceDownloadSize', { size });
}

function ModelFeedback({ controls }: { controls: ModelControls }) {
  const { t } = useI18n();
  const { status, install, cancel, remove, error } = controls;

  if (status.isPending) return <Loading label={t('LoadingSettings')} />;

  if (!error) return null;

  return (
    <Settings.Status
      action={
        <RetryButton
          label={t('Retry')}
          variant="outline"
          size="sm"
          onClick={() => {
            install.reset();
            cancel.reset();
            remove.reset();
            status.refetch();
          }}
        />
      }
    >
      {t('VoiceModelFailed')}
    </Settings.Status>
  );
}

export function VoiceLanguageRow() {
  const { t, count } = useI18n();
  const status = rpc.voice.status.useQuery({});
  const model = activeModel(status.data);

  if (model?.languageDetection !== 'automatic') return null;

  const description =
    t('VoiceLanguages') + ' ' + count('supportedLanguage', model.languages.length);

  return (
    <Settings.Row title={t('VoiceLanguage')} description={description}>
      {t('VoiceAutomatic')}
    </Settings.Row>
  );
}

function DownloadProgress({ status }: { status: VoiceStatus }) {
  const { t } = useI18n();

  if (status?.state !== 'downloading') return null;

  return (
    <div role="status">
      <progress
        aria-label={t('VoiceModelDownloading')}
        value={status.downloadedBytes}
        max={status.totalBytes}
      />
      <span>{Math.floor((status.downloadedBytes / status.totalBytes) * 100)}%</span>
    </div>
  );
}

function ModelAction({ controls }: { controls: ModelControls }) {
  const { t } = useI18n();
  const { status, state, busy, install, cancel, remove } = controls;
  const installationId = status.data?.installationId;

  switch (state) {
    case 'missing':
      return (
        <Button
          type="button"
          disabled={busy || install.isPending}
          onClick={() => {
            install.reset();
            void install.mutateAsync({}).catch(() => {});
          }}
        >
          {t('VoiceDownload')}
        </Button>
      );
    case 'downloading':
      return (
        <Button
          type="button"
          variant="outline"
          disabled={busy || !installationId}
          onClick={() => {
            if (installationId) void cancel.mutateAsync({ installationId }).catch(() => {});
          }}
        >
          {t('VoiceCancelDownload')}
        </Button>
      );
    case 'ready':
      return (
        <Button
          type="button"
          variant="destructive-outline"
          disabled={busy}
          onClick={() => {
            void remove.mutateAsync({}).catch(() => {});
          }}
        >
          {t('VoiceRemove')}
        </Button>
      );
    default:
      return null;
  }
}
