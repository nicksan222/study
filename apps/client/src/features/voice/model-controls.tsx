import { failureSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button, RetryButton, Loading, Settings } from '@study/ui';
import { Schema } from 'effect';

import { useI18n } from '#client/lib/i18n.tsx';

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

/** Shared explicit model lifecycle for first-use setup and Voice settings. */
export function VoiceModelControls() {
  const { t } = useI18n();
  const { status, install, cancel, remove, state, busy, error } = useModelControls();

  return (
    <>
      <Settings.Intro>{t('VoiceModelDescription')}</Settings.Intro>
      {status.isPending && <Loading label={t('LoadingSettings')} />}
      {error && (
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
      )}
      {state && <Settings.Feedback>{t(stateLabels[state])}</Settings.Feedback>}
      <DownloadProgress status={status.data} />
      <ModelActions state={state} busy={busy} install={install} cancel={cancel} remove={remove} />
    </>
  );
}

function DownloadProgress({
  status
}: {
  status: ReturnType<typeof rpc.voice.status.useQuery>['data'];
}) {
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

function ModelActions({
  state,
  busy,
  install,
  cancel,
  remove
}: {
  state: NonNullable<ReturnType<typeof rpc.voice.status.useQuery>['data']>['state'] | undefined;
  busy: boolean;
  install: ReturnType<typeof rpc.voice.install.useMutation>;
  cancel: ReturnType<typeof rpc.voice.cancelInstall.useMutation>;
  remove: ReturnType<typeof rpc.voice.remove.useMutation>;
}) {
  const { t } = useI18n();

  return (
    <Settings.Actions>
      {state === 'missing' && (
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
      )}
      {state === 'downloading' && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void cancel.mutateAsync({}).catch(() => {});
          }}
        >
          {t('VoiceCancelDownload')}
        </Button>
      )}
      {state === 'ready' && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void remove.mutateAsync({}).catch(() => {});
          }}
        >
          {t('VoiceRemove')}
        </Button>
      )}
    </Settings.Actions>
  );
}
