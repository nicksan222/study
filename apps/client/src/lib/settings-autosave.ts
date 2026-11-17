import { toastManager } from '@study/ui';
import { useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

/** Serializes preference patches and retains failed changes for an explicit retry. */
export function useSettingsAutosave<T extends object>(
  read: () => Promise<T>,
  write: (value: T) => Promise<unknown>
) {
  const { t } = useI18n();
  const callbacks = useRef({ read, write, t });

  callbacks.current = { read, write, t };
  const queue = useRef<Partial<T>>({});
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function flush() {
    if (running.current || !Object.keys(queue.current).length) return;

    running.current = true;
    setPending(true);
    setError(false);

    try {
      while (Object.keys(queue.current).length) {
        const patch = queue.current;

        queue.current = {};

        try {
          const current = await callbacks.current.read();

          await callbacks.current.write({ ...current, ...patch });
        } catch {
          queue.current = { ...patch, ...queue.current };
          setError(true);
          toastManager.add({
            title: callbacks.current.t('SettingsSaveFailed'),
            type: 'error'
          });
          break;
        }
      }
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return {
    pending,
    error,
    update: (patch: Partial<T>) => {
      queue.current = { ...queue.current, ...patch };
      void flush();
    },
    retry: () => void flush()
  };
}

/** Validates editable numeric preferences without accepting an empty draft as zero. */
export function validSettingsNumber(value: string, min: number, max: number) {
  const number = Number(value);

  return value.trim() !== '' && Number.isInteger(number) && number >= min && number <= max;
}

/** A numeric draft is acknowledged only when the live query contains that value. */
export function isPersistedNumberDraft(draft: string | undefined, value: number | undefined) {
  return draft !== undefined && draft.trim() !== '' && Number(draft) === value;
}
