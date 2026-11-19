import { Button, toastManager } from '@study/ui';
import { useCallback, useEffect, useEffectEvent, useRef } from 'react';
import type { ReactNode } from 'react';

import { useDesktopInstallation } from '#client/lib/desktop-updates.ts';
import { useNativeAsync } from '#client/lib/effect/native.ts';
import {
  checkDesktopUpdate,
  desktopUpdateStatus,
  hostCapabilities,
  listenForDesktopUpdateCheck,
  setDesktopUpdateMenu
} from '#client/lib/host.ts';
import { useI18n } from '#client/lib/i18n.tsx';

/** Checks signed desktop builds quietly and downloads only after explicit consent. */
export function DesktopUpdates({
  renderRecovery
}: {
  renderRecovery?: (action: ReactNode) => ReactNode;
} = {}) {
  const { t } = useI18n();
  const { announce, announced, installing } = useDesktopUpdateNotices();
  const status = useNativeAsync(desktopUpdateStatus, hostCapabilities().updates);
  const supported = status.data?.supported === true;
  const update = useNativeAsync(checkDesktopUpdate, supported);
  const manualCheck = useRef(false);

  useEffect(() => {
    const version = update.data ?? null;

    if (announced.current !== version && !manualCheck.current) announce(version);
  }, [update.data, announce, announced]);

  async function check() {
    if (manualCheck.current || installing) return;

    manualCheck.current = true;
    const checking = toastManager.add({ title: t('UpdateChecking'), timeout: 0 });
    const version = await update.refetch();

    manualCheck.current = false;
    toastManager.close(checking);

    if (version === undefined) {
      toastManager.add({ title: t('DesktopUpdateCheckFailed'), type: 'error' });
    } else {
      announce(version);

      if (version === null) toastManager.add({ title: t('UpdateCurrent') });
    }
  }

  useDesktopUpdateMenu(supported, t('Updates'), t('UpdateCheck'), check);

  return (
    renderRecovery?.(
      supported ? (
        <Button
          size="sm"
          variant="outline"
          disabled={update.isFetching || installing}
          onClick={() => void check()}
        >
          {t(update.isFetching ? 'UpdateChecking' : 'UpdateCheck')}
        </Button>
      ) : null
    ) ?? null
  );
}

function useDesktopUpdateNotices() {
  const { t } = useI18n();
  const installation = useDesktopInstallation();
  const installing = installation.isPending;
  const announced = useRef<string | null>(null);
  const progress = useRef<string | null>(null);
  const notice = useRef<string | null>(null);
  const closeNotice = useCallback(() => {
    if (!notice.current) return;

    toastManager.close(notice.current);
    notice.current = null;
  }, []);
  const runInstall = installation.mutateAsync;
  const install = useCallback(
    function install(version: string) {
      if (installing) return;

      progress.current = toastManager.add({ title: t('DesktopUpdateInstalling'), timeout: 0 });
      void runInstall(version)
        .catch(() => {
          if (announced.current !== version) return;

          notice.current = toastManager.add({
            title: t('DesktopUpdateFailed'),
            description: t('DesktopUpdateRetryHelp'),
            type: 'error',
            timeout: 0,
            actionProps: {
              children: t('Retry'),
              onClick: () => {
                closeNotice();
                install(version);
              }
            }
          });
        })
        .finally(() => {
          if (progress.current) toastManager.close(progress.current);
        });
    },
    [installing, runInstall, t, closeNotice]
  );

  useEffect(() => {
    if (installing) closeNotice();
  }, [installing, closeNotice]);

  const announce = useCallback(
    (version: string | null) => {
      closeNotice();
      announced.current = version;

      if (!version) return;

      notice.current = toastManager.add({
        title: t('DesktopUpdateAvailable', { version }),
        description: t('DesktopUpdateConsent'),
        timeout: 0,
        actionProps: {
          children: t('DesktopUpdateInstall'),
          onClick: () => {
            if (announced.current !== version || installing) return;

            closeNotice();
            install(version);
          }
        }
      });
    },
    [closeNotice, install, installing, t]
  );

  return { announce, announced, installing };
}

function useDesktopUpdateMenu(
  supported: boolean,
  menuLabel: string,
  itemLabel: string,
  check: () => Promise<void>
) {
  const onMenuCheck = useEffectEvent(() => void check());

  useEffect(() => {
    if (!supported) return;

    const subscription = listenForDesktopUpdateCheck(() => onMenuCheck());
    let active = true;

    void subscription
      .then(() => {
        if (active) return setDesktopUpdateMenu(menuLabel, itemLabel);
      })
      .catch(() => {});

    return () => {
      active = false;
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [supported, menuLabel, itemLabel]);
}
