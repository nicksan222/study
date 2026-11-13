import { queryOptions } from '@tanstack/react-query';

import { diagnosticLog, hostCapabilities } from '#client/lib/host.ts';

/** Reads desktop diagnostics on demand; browser consumers leave the native query disabled. */
export function diagnosticLogQueryOptions() {
  return queryOptions({
    queryKey: ['diagnostic-log'],
    queryFn: diagnosticLog,
    enabled: hostCapabilities().diagnostics,
    retry: false,
    refetchOnWindowFocus: false
  });
}
