import type { NoteId } from '@study/contracts/ids';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';
import { sidebarSettingsOptions } from '#web/lib/study-client/sidebar.queries.ts';

/** Loads the threshold and periodically refreshes persisted note summaries. */
export function useSidebarProgress() {
  const settings = useQuery(sidebarSettingsOptions());
  const progress = useQuery({
    queryKey: ['notes', 'sidebar-progress'],
    queryFn: ({ signal }) => request((rpc) => rpc['notes.noteSummaries']({}), signal),
    refetchInterval: 3000
  });

  return { settings, progress };
}

/** Saves a settlement override and refreshes the grouped note summaries. */
export function useNoteSettlement(id: NoteId) {
  const cache = useQueryClient();

  return useMutation({
    mutationFn: (settled: boolean) =>
      request((rpc) => rpc['notes.setNoteSettled']({ id, settled })),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['notes', 'sidebar-progress'] });
    }
  });
}
