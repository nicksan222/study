import { toastManager } from '@study/ui';
import { useLayoutEffect, useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

export function useSettingsAutosave<T extends object>(
  read: () => Promise<T>,
  write: (value: T) => Promise<unknown>
) {
  const writer = useRef(write);

  useLayoutEffect(() => {
    writer.current = write;
  }, [write]);

  return useSettingsPatchAutosave<T>(async (patch) => {
    const latest = await read();

    await writer.current({ ...latest, ...patch });
  });
}

/** Serializes preference patches and retains failed changes for an explicit retry. */
export function useSettingsPatchAutosave<T extends object>(
  write: (patch: Partial<T>) => Promise<unknown>
) {
  const { t } = useI18n();
  const callbacks = useRef({ write, t });

  useLayoutEffect(() => {
    callbacks.current = { write, t };
  }, [write, t]);

  const failed = useRef<Partial<T>>({});
  const queue = useRef<Partial<T>>({});
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  function forgetSupersededErrors(patch: Partial<T>) {
    for (const key in patch) delete failed.current[key];

    setError(!!Object.keys(failed.current).length);
  }

  async function flush() {
    if (running.current || !Object.keys(queue.current).length) return;

    running.current = true;
    setPending(true);

    try {
      while (Object.keys(queue.current).length) {
        const patch = queue.current;

        queue.current = {};

        try {
          await callbacks.current.write(patch);
        } catch {
          failed.current = { ...failed.current, ...patch };

          forgetSupersededErrors(queue.current);
          toastManager.add({
            title: callbacks.current.t('SettingsSaveFailed'),
            type: 'error'
          });
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
      forgetSupersededErrors(patch);
      queue.current = { ...queue.current, ...patch };
      void flush();
    },
    retry: () => {
      queue.current = { ...failed.current, ...queue.current };
      failed.current = {};
      setError(false);
      void flush();
    }
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
