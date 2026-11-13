import { queryOptions } from '@tanstack/react-query';

import { loadAiSettings } from './ai-settings';

export function aiSettingsQueryOptions() {
  return queryOptions({
    queryKey: ['ai-settings'],
    queryFn: ({ signal }) => loadAiSettings(signal)
  });
}
