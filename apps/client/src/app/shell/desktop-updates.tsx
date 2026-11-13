import { toastManager } from '@study/ui/toast';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import {
  desktopUpdateQueryOptions,
  installDesktopUpdateMutationOptions
} from '#client/lib/desktop-updates.queries.ts';
import { useI18n } from '#client/lib/i18n.tsx';

/** Checks signed desktop builds quietly and downloads only after explicit consent. */
export function DesktopUpdates() {
  const { t } = useI18n();
  const client = useQueryClient();
  const installing = useIsMutating({ mutationKey: ['desktop-update-install'] }) > 0;
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
            if (
              announced.current !== version ||
              client.isMutating({ mutationKey: ['desktop-update-install'] })
            )
              return;

            closeNotice();
            install.mutate(version);
          }
        }
      });
    }
  });

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
          if (
            announced.current !== version ||
            client.isMutating({ mutationKey: ['desktop-update-install'] })
          )
            return;

          closeNotice();
          install.mutate(version);
        }
      }
    });
  }, [update.data, install, t, closeNotice, client]);

  return null;
}
