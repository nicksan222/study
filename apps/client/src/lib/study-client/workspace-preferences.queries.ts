import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import type { WorkspacePreferences } from '@study/contracts/settings/types';
import { queryOptions, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { request } from './request';

/** Loads the single persisted source for editor, capture, reader, and navigation defaults. */
const workspacePreferencesOptions = () =>
  queryOptions({
    queryKey: ['workspace-preferences'],
    queryFn: ({ signal }) => request((rpc) => rpc['settings.workspacePreferences']({}), signal),
    staleTime: 30_000
  });

/** Consumers remain usable with canonical defaults while preferences load or reconnect. */
export function useWorkspacePreferences(): WorkspacePreferences {
  return useQuery(workspacePreferencesOptions()).data ?? defaultWorkspacePreferences;
}

/** Read before each partial update so unrelated preferences from another window survive. */
export function useWorkspacePreferenceControls() {
  const cache = useQueryClient();
  const query = useQuery(workspacePreferencesOptions());
  const mutation = useMutation({
    mutationFn: async (patch: Partial<WorkspacePreferences>) => {
      const current = await request((rpc) => rpc['settings.workspacePreferences']({}));

      return request((rpc) => rpc['settings.saveWorkspacePreferences']({ ...current, ...patch }));
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: workspacePreferencesOptions().queryKey })
  });

  return { query, mutation };
}
