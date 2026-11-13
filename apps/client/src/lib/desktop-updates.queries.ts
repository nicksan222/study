import { mutationOptions, queryOptions } from '@tanstack/react-query';

import {
  checkDesktopUpdate,
  desktopUpdateStatus,
  hostCapabilities,
  installDesktopUpdate
} from './host';

export function desktopUpdateStatusQueryOptions() {
  return queryOptions({
    queryKey: ['desktop-update-status'],
    queryFn: desktopUpdateStatus,
    enabled: hostCapabilities().updates,
    staleTime: Infinity,
    retry: false
  });
}

/** Native checks use the updater configuration embedded by the signed release build. */
export function desktopUpdateQueryOptions() {
  return queryOptions({
    queryKey: ['desktop-update'],
    queryFn: checkDesktopUpdate,
    enabled: hostCapabilities().updates,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: 60 * 60 * 1000
  });
}

export function installDesktopUpdateMutationOptions() {
  return mutationOptions({
    mutationKey: ['desktop-update-install'],
    mutationFn: installDesktopUpdate
  });
}
