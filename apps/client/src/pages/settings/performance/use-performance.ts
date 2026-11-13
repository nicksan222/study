import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { concurrencyQueryOptions, concurrencyMutationOptions } from './performance.queries';
import type { ConcurrencyField } from './performance.queries';

const bounds = { maxConcurrentAi: { min: 1, max: 8 }, maxQueuedAi: { min: 0, max: 64 } } as const;

export function usePerformanceSettings() {
  const client = useQueryClient();
  const query = useQuery(concurrencyQueryOptions());
  const [drafts, setDrafts] = useState<Partial<Record<ConcurrencyField, string>>>({});
  const mutation = useMutation({
    ...concurrencyMutationOptions(),
    onSuccess: async (_, change) => {
      await client.invalidateQueries({ queryKey: concurrencyQueryOptions().queryKey });
      setDrafts((current) => ({ ...current, [change.field]: undefined }));
    },
    onError: (_, change) => setDrafts((current) => ({ ...current, [change.field]: undefined }))
  });

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
          mutation.mutate({ field, value: number, settings: query.data });
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
