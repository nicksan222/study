import { mutationOptions, queryOptions } from '@tanstack/react-query';
import { invoke, isTauri } from '@tauri-apps/api/core';

/** Native checks use the updater configuration embedded by the signed release build. */
export function desktopUpdateQueryOptions() {
  return queryOptions({
    queryKey: ['desktop-update'],
    queryFn: () => invoke<string | null>('check_for_update'),
    enabled: isTauri(),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: 60 * 60 * 1000
  });
}

export function installDesktopUpdateMutationOptions() {
  return mutationOptions({
    mutationFn: (expectedVersion: string) => invoke<void>('install_update', { expectedVersion })
  });
}
