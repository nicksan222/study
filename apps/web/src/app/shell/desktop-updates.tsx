import { toastManager } from '@study/ui/toast';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import {
  desktopUpdateQueryOptions,
  installDesktopUpdateMutationOptions
} from './desktop-updates.queries';

/** Checks signed desktop builds quietly and downloads only after explicit consent. */
export function DesktopUpdates() {
  const { t } = useI18n();
  const announced = useRef<string | null>(null);
  const progress = useRef<string | null>(null);
  const notice = useRef<string | null>(null);
  const closeNotice = useCallback(() => {
    if (!notice.current) return;

    toastManager.close(notice.current);
    notice.current = null;
  }, []);
  const update = useQuery(desktopUpdateQueryOptions());
  const install = useMutation({
    ...installDesktopUpdateMutationOptions(),
    onMutate: () => {
      progress.current = toastManager.add({ title: t('DesktopUpdateInstalling'), timeout: 0 });
    },
    onSettled: () => {
      if (progress.current) toastManager.close(progress.current);
    },
    onError: (_error, version) => {
      if (announced.current !== version) return;

      notice.current = toastManager.add({
        title: t('DesktopUpdateFailed'),
        description: t('DesktopUpdateRetryHelp'),
        type: 'error',
        timeout: 0,
        actionProps: {
          children: t('Retry'),
          onClick: () => {
            if (announced.current !== version) return;

            closeNotice();
            install.mutate(version);
          }
        }
      });
    }
  });

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
          if (announced.current !== version) return;

          closeNotice();
          install.mutate(version);
        }
      }
    });
  }, [update.data, install, t, closeNotice]);

  return null;
}
