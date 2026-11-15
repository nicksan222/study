import { rpc } from '@study/contracts/react';
import type { ConcurrencySettings } from '@study/contracts/settings/types';
import { useState } from 'react';

type ConcurrencyField = keyof ConcurrencySettings;

const bounds = { maxConcurrentAi: { min: 1, max: 8 }, maxQueuedAi: { min: 0, max: 64 } } as const;

export function usePerformanceSettings() {
  const query = rpc.settings.concurrencySettings.useQuery({});
  const [drafts, setDrafts] = useState<Partial<Record<ConcurrencyField, string>>>({});
  const mutation = rpc.settings.saveConcurrencySettings.useMutation();

  function control(field: ConcurrencyField) {
    const { min, max } = bounds[field];
    const value = drafts[field] ?? String(query.data?.[field] ?? '');
    const number = Number(value);
    const valid = value.trim() !== '' && Number.isInteger(number) && number >= min && number <= max;
    const changed = query.data !== undefined && number !== query.data[field];

    return {
      min,
      max,
      value,
      valid,
      changed,
      setValue: (next: string) => setDrafts((current) => ({ ...current, [field]: next })),
      save: () => {
        if (query.data && valid && changed && !mutation.isPending) {
          void mutation
            .mutateAsync({ ...query.data, [field]: number })
            .then(() => setDrafts((current) => ({ ...current, [field]: undefined })))
            .catch(() => {});
        }
      }
    };
  }

  return {
    data: query.data,
    active: control('maxConcurrentAi'),
    queued: control('maxQueuedAi'),
    loading: query.isPending,
    pending: mutation.isPending,
    error: query.isError || mutation.isError,
    retry: () => {
      mutation.reset();
      setDrafts({});
      void query.refetch();
    }
  };
}
