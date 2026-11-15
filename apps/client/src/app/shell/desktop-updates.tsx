import { toastManager } from '@study/ui';
import { useCallback, useEffect, useRef } from 'react';

import { useDesktopUpdate, useDesktopInstallation } from '#client/lib/desktop-updates.ts';
import { useI18n } from '#client/lib/i18n.tsx';

/** Checks signed desktop builds quietly and downloads only after explicit consent. */
export function DesktopUpdates() {
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
  const update = useDesktopUpdate();
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

  useEffect(() => {
    const version = update.data ?? null;

    if (announced.current === version) return;

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
  }, [update.data, install, t, closeNotice, installing]);

  return null;
}
