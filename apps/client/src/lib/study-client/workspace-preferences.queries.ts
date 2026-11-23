import { defaultWorkspacePreferences } from '@study/contracts';
import type { WorkspacePreferences } from '@study/contracts';
import { rpc } from '@study/contracts/react';

import { useSettingsAutosave } from '#client/lib/settings-autosave.ts';

/** Product interaction defaults remain available while the authoritative preferences load. */
export function useWorkspacePreferences(): WorkspacePreferences {
  return rpc.settings.workspacePreferences.useQuery({}).data ?? defaultWorkspacePreferences;
}

export function useWorkspacePreferenceControls() {
  const query = rpc.settings.workspacePreferences.useQuery({});
  const write = rpc.settings.saveWorkspacePreferences.useMutation();
  const autosave = useSettingsAutosave(
    () => rpc.settings.workspacePreferences.read({}),
    write.mutateAsync
  );

  return {
    query,
    mutation: {
      isPending: autosave.pending,
      error: autosave.error,
      reset: autosave.retry,
      mutate: autosave.update
    }
  };
}
