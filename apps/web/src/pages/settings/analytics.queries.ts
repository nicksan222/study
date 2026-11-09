import { queryOptions } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

export function diagnosticLogQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: ['diagnostic-log'],
    queryFn: () => invoke<string>('diagnostic_log'),
    enabled,
    retry: false,
    refetchOnWindowFocus: false
  });
}
