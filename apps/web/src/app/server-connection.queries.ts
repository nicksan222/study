import { queryOptions } from '@tanstack/react-query';

import { serverConnection } from '#web/lib/study-client/connection.ts';
import { loadServerHealth } from '#web/lib/study-client/health.ts';

export function serverConnectionQueryOptions() {
  return queryOptions({
    queryKey: ['server-connection'],
    queryFn: async ({ signal }) => {
      const revision = serverConnection.snapshot().revision;

      try {
        const value = await loadServerHealth(signal);

        serverConnection.recovered(revision);

        return value;
      } catch (error) {
        if (!signal.aborted) serverConnection.disconnected();

        throw error;
      }
    }
  });
}
