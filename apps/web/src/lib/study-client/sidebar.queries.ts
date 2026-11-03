import { queryOptions } from '@tanstack/react-query';

import { request } from './request';

export const sidebarSettingsOptions = () =>
  queryOptions({
    queryKey: ['settings', 'sidebar'],
    queryFn: ({ signal }) => request((rpc) => rpc['settings.sidebarSettings']({}), signal)
  });
