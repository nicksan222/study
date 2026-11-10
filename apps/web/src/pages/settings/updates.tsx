import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { Settings } from '@study/ui/settings';
import { useIsMutating, useMutation, useQuery } from '@tanstack/react-query';
import { isTauri } from '@tauri-apps/api/core';

import {
  desktopUpdateQueryOptions,
  desktopUpdateStatusQueryOptions,
  installDesktopUpdateMutationOptions
} from '#web/lib/desktop-updates.queries.ts';
import { useI18n } from '#web/lib/i18n.tsx';

export function UpdatesSettings() {
  const { t } = useI18n();
  const status = useQuery(desktopUpdateStatusQueryOptions());
  const update = useQuery({ ...desktopUpdateQueryOptions(), enabled: false });
  const install = useMutation(installDesktopUpdateMutationOptions());
  const installing = useIsMutating({ mutationKey: ['desktop-update-install'] }) > 0;
  const supported = isTauri() && status.data?.supported;
  const busy = update.isFetching || installing;
  const failed = status.isError || update.isError || install.isError;

  return (
    <Settings.Section title={t('Updates')}>
      <Settings.Intro>{t('UpdatesDescription')}</Settings.Intro>
      {status.data && (
        <Settings.Row title={t('UpdateVersion')}>
          <span>{status.data.version}</span>
        </Settings.Row>
      )}
      {!isTauri() || status.data?.supported === false ? (
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
      {supported && (
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
      )}
    </Settings.Section>
  );
}
