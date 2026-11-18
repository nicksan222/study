import { rpc } from '@study/contracts/react';
import { toastManager } from '@study/ui';
import { useEffect, useRef } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

const tierLabels = {
  tiny: 'AiSettingsTiny',
  medium: 'AiSettingsMedium',
  smart: 'AiSettingsSmart'
} as const;

/** Deliver the next durable notice using the shared toast viewport. */
export function ModelUpdateNotifications() {
  const { data } = rpc.settings.modelUpdates.useQuery({});
  const { mutate } = rpc.settings.dismissModelUpdate.useMutation();
  const { mutate: apply } = rpc.settings.applyModelUpdate.useMutation();
  const { t } = useI18n();
  const announced = useRef<{ key: string; translate: typeof t }>(undefined);

  useEffect(() => {
    const update = data?.[0];

    if (!update) {
      if (data && announced.current) {
        announced.current = undefined;
        toastManager.close('model-update');
      }

      return;
    }

    const key = JSON.stringify([update.tier, update.provider, update.previousModel, update.model]);
    const copy = {
      title: t('ModelUpdateAvailable'),
      description: update.previousModel
        ? t('ModelUpdateOffer', {
            tier: t(tierLabels[update.tier]),
            previous: update.previousModel,
            model: update.model
          })
        : t('ModelSuggestionOffer', { tier: t(tierLabels[update.tier]), model: update.model }),
      actionProps: {
        children: t('ModelUpdateAction'),
        onClick: () => {
          void apply(update).catch(() =>
            toastManager.add({ type: 'error', title: t('ModelUpdateFailed') })
          );
        }
      }
    };

    if (announced.current?.key === key) {
      if (announced.current.translate !== t) toastManager.update('model-update', copy);

      announced.current = { key, translate: t };

      return;
    }

    announced.current = { key, translate: t };
    toastManager.add({
      id: 'model-update',
      ...copy,
      type: 'info',
      timeout: 0,
      onClose: () => {
        // A failed acknowledgement leaves the notice available on the next launch.
        void mutate(update).catch(() => undefined);
      }
    });
  }, [data, mutate, apply, t]);

  return null;
}
