import type { ModelUpdate } from '@study/contracts';
import type { ProtocolTransport } from '@study/contracts/react';
import { rpc } from '@study/contracts/react';
import { toastManager } from '@study/ui';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

const tierLabels = {
  tiny: 'AiSettingsTiny',
  medium: 'AiSettingsMedium',
  smart: 'AiSettingsSmart'
} as const;

function noticeCopy(t: ReturnType<typeof useI18n>['t'], update: ModelUpdate) {
  const tier = t(tierLabels[update.tier]);

  return {
    title: t('ModelUpdateAvailable'),
    description: update.previousModel
      ? t('ModelUpdateOffer', { tier, previous: update.previousModel, model: update.model })
      : t('ModelSuggestionOffer', { tier, model: update.model })
  };
}

/** Deliver the next durable notice using the shared toast viewport. */
export function ModelUpdateNotifications({ transport }: { transport: ProtocolTransport }) {
  const { data } = rpc.settings.modelUpdates.useQuery({});
  const { mutate } = rpc.settings.dismissModelUpdate.useMutation();
  const { mutate: apply } = rpc.settings.applyModelUpdate.useMutation();
  const { t } = useI18n();
  const announced = useRef<{
    key: string;
    translate: typeof t;
    applying: boolean;
    closed: boolean;
  }>(undefined);
  const [retry, setRetry] = useState(0);

  useEffect(
    () => () => {
      if (!announced.current) return;

      announced.current = undefined;
      toastManager.close('model-update');
    },
    [transport]
  );

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
    const current = announced.current;
    const owner =
      current?.key === key ? current : { key, translate: t, applying: false, closed: false };
    const reopen = () => {
      announced.current = undefined;
      setRetry((value) => value + 1);
    };
    const copy = {
      ...noticeCopy(t, update),
      actionProps: {
        children: t('ModelUpdateAction'),
        onClick: () => {
          if (announced.current !== owner || owner.applying) return;

          owner.applying = true;
          void apply(update).catch(() => {
            if (announced.current !== owner) return;

            owner.applying = false;
            toastManager.add({ type: 'error', title: t('ModelUpdateFailed') });

            if (owner.closed) reopen();
          });
        }
      }
    };

    if (announced.current?.key === key) {
      if (announced.current.translate !== t) toastManager.update('model-update', copy);

      announced.current.translate = t;

      return;
    }

    announced.current = owner;
    toastManager.add({
      id: 'model-update',
      ...copy,
      type: 'info',
      timeout: 0,
      onClose: () => {
        if (announced.current !== owner) return;

        owner.closed = true;

        if (owner.applying) return;

        void mutate(update).catch(() => {
          if (announced.current === owner) reopen();
        });
      }
    });
  }, [data, mutate, apply, t, transport, retry]);

  return null;
}
