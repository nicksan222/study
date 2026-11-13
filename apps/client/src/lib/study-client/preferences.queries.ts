import { queryOptions } from '@tanstack/react-query';

import { loadAppSettings } from './preferences';

export const appSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ['app-settings'],
    queryFn: ({ signal }) => loadAppSettings(signal)
  });
