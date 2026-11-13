import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { Settings } from '@study/ui/settings';
import { useIsMutating, useMutation, useQuery } from '@tanstack/react-query';

import {
  desktopUpdateQueryOptions,
  desktopUpdateStatusQueryOptions,
  installDesktopUpdateMutationOptions
} from '#client/lib/desktop-updates.queries.ts';
import { hostCapabilities } from '#client/lib/host.ts';
import { useI18n } from '#client/lib/i18n.tsx';

function useUpdates() {
  const status = useQuery(desktopUpdateStatusQueryOptions());
  const update = useQuery({ ...desktopUpdateQueryOptions(), enabled: false });
  const install = useMutation(installDesktopUpdateMutationOptions());
  const installing = useIsMutating({ mutationKey: ['desktop-update-install'] }) > 0;
  const busy = update.isFetching || installing;
  const failed = status.isError || update.isError || install.isError;

  return { status, update, install, installing, busy, failed };
}

export function UpdatesSettings() {
  const { t } = useI18n();
  const model = useUpdates();
  const { status, failed } = model;
  const supported = hostCapabilities().updates && status.data?.supported;

  return (
    <Settings.Section title={t('Updates')}>
      <Settings.Intro>{t('UpdatesDescription')}</Settings.Intro>
      {status.data && (
        <Settings.Row title={t('UpdateVersion')}>
          <span>{status.data.version}</span>
        </Settings.Row>
      )}
      {!hostCapabilities().updates || status.data?.supported === false ? (
        <Settings.Feedback>{t('UpdateUnavailable')}</Settings.Feedback>
      ) : null}
      {failed && (
        <Settings.Status
          action={
            status.isError ? (
              <RetryButton
                variant="outline"
                label={t('Retry')}
                onClick={() => void status.refetch()}
              />
            ) : undefined
          }
        >
          {t('UpdateFailed')}
        </Settings.Status>
      )}
      {supported && <UpdateControls model={model} />}
    </Settings.Section>
  );
}

function UpdateControls({ model }: { model: ReturnType<typeof useUpdates> }) {
  const { t } = useI18n();
  const { update, install, installing, busy, failed } = model;

  return (
    <>
      <Settings.Actions>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            install.reset();
            void update.refetch();
          }}
        >
          {t(update.isFetching ? 'UpdateChecking' : 'UpdateCheck')}
        </Button>
        {update.data && (
          <Button disabled={busy} onClick={() => install.mutate(update.data!)}>
            {t('UpdateInstall')}
          </Button>
        )}
      </Settings.Actions>
      <div role="status" aria-live="polite">
        {installing ? (
          t('UpdateInstalling')
        ) : update.data ? (
          <>
            <p>{t('DesktopUpdateAvailable', { version: update.data })}</p>
            <p>{t('UpdateReady')}</p>
          </>
        ) : update.isSuccess && !failed && !update.isFetching ? (
          t('UpdateCurrent')
        ) : null}
      </div>
    </>
  );
}
