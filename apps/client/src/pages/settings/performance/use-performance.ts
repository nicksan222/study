import type { ConcurrencySettings } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useState } from 'react';

import {
  useSettingsAutosave,
  validSettingsNumber,
  isPersistedNumberDraft
} from '#client/lib/settings-autosave.ts';

type ConcurrencyField = keyof ConcurrencySettings;

const bounds = { maxConcurrentAi: { min: 1, max: 8 }, maxQueuedAi: { min: 0, max: 64 } } as const;

export function usePerformanceSettings() {
  const query = rpc.settings.concurrencySettings.useQuery({});
  const [drafts, setDrafts] = useState<Partial<Record<ConcurrencyField, string>>>({});
  const mutation = rpc.settings.saveConcurrencySettings.useMutation();

  const autosave = useSettingsAutosave(
    () => rpc.settings.concurrencySettings.read({}),
    mutation.mutateAsync
  );

  const confirmed = Object.keys(drafts).filter((key) => {
    const field = key as ConcurrencyField;

    return (
      !autosave.pending &&
      !autosave.error &&
      isPersistedNumberDraft(drafts[field], query.data?.[field])
    );
  });

  if (confirmed.length)
    setDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !confirmed.includes(key)))
    );

  function control(field: ConcurrencyField) {
    const { min, max } = bounds[field];
    const value = drafts[field] ?? String(query.data?.[field] ?? '');
    const number = Number(value);
    const valid = validSettingsNumber(value, min, max);
    const changed = query.data !== undefined && number !== query.data[field];

    return {
      min,
      max,
      value,
      valid,
      changed,
      setValue: (next: string) => {
        setDrafts((current) => ({ ...current, [field]: next }));
        const number = Number(next);

        if (query.data && validSettingsNumber(next, min, max)) autosave.update({ [field]: number });
      }
    };
  }

  return {
    data: query.data,
    active: control('maxConcurrentAi'),
    queued: control('maxQueuedAi'),
    loading: query.isPending,
    pending: autosave.pending,
    error: query.isError || autosave.error,
    retry: () => {
      autosave.retry();
      void query.refetch();
    }
  };
}
