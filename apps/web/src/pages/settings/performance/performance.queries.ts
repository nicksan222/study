import type { ConcurrencySettings } from '@study/contracts/settings/types';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import {
  loadConcurrencySettings,
  saveConcurrencySettings
} from '#web/lib/study-client/concurrency.ts';

export type ConcurrencyField = keyof ConcurrencySettings;

interface ConcurrencyChange {
  field: ConcurrencyField;
  value: number;
  settings: ConcurrencySettings;
}

export const concurrencyQueryOptions = () =>
  queryOptions({
    queryKey: ['concurrency-settings'],
    queryFn: ({ signal }) => loadConcurrencySettings(signal)
  });

export const concurrencyMutationOptions = () =>
  mutationOptions({
    mutationFn: ({ field, value, settings }: ConcurrencyChange) =>
      saveConcurrencySettings({ ...settings, [field]: value })
  });
