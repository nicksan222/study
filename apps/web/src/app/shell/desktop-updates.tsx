import { toastManager } from '@study/ui/toast';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

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
  const update = useQuery(desktopUpdateQueryOptions());
  const install = useMutation({
    ...installDesktopUpdateMutationOptions(),
    onMutate: () => {
      progress.current = toastManager.add({ title: t('DesktopUpdateInstalling'), timeout: 0 });
    },
    onSettled: () => {
      if (progress.current) toastManager.close(progress.current);
    },
    onError: () => {
      const notice = toastManager.add({
        title: t('DesktopUpdateFailed'),
        description: t('DesktopUpdateRetryHelp'),
        type: 'error',
        timeout: 0,
        actionProps: {
          children: t('Retry'),
          onClick: () => {
            toastManager.close(notice);
            install.mutate();
          }
        }
      });
    }
  });

  useEffect(() => {
    if (!update.data || announced.current === update.data) return;

    announced.current = update.data;
    const notice = toastManager.add({
      title: t('DesktopUpdateAvailable', { version: update.data }),
      description: t('DesktopUpdateConsent'),
      timeout: 0,
      actionProps: {
        children: t('DesktopUpdateInstall'),
        onClick: () => {
          toastManager.close(notice);
          install.mutate();
        }
      }
    });
  }, [update.data, install, t]);

  return null;
}
