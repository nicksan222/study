import type { SessionId } from '@study/contracts/ids';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';
import { sidebarSettingsOptions } from '#web/lib/study-client/sidebar.queries.ts';

/** Loads the threshold and periodically refreshes persisted session summaries. */
export function useSidebarProgress() {
  const settings = useQuery(sidebarSettingsOptions());
  const progress = useQuery({
    queryKey: ['sessions', 'sidebar-progress'],
    queryFn: ({ signal }) => request((rpc) => rpc['conversations.sessionSummaries']({}), signal),
    refetchInterval: 3000
  });

  return { settings, progress };
}

/** Saves a settlement override and refreshes the grouped session summaries. */
export function useSessionSettlement(id: SessionId) {
  const cache = useQueryClient();

  return useMutation({
    mutationFn: (settled: boolean) =>
      request((rpc) => rpc['conversations.setSessionSettled']({ id, settled })),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['sessions', 'sidebar-progress'] });
    }
  });
}
