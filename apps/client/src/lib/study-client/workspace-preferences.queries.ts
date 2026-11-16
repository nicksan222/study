import { defaultWorkspacePreferences } from '@study/contracts';
import type { WorkspacePreferences } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useState } from 'react';

/** Product interaction defaults remain available while the authoritative preferences load. */
export function useWorkspacePreferences(): WorkspacePreferences {
  return rpc.settings.workspacePreferences.useQuery({}).data ?? defaultWorkspacePreferences;
}

export function useWorkspacePreferenceControls() {
  const query = rpc.settings.workspacePreferences.useQuery({});
  const write = rpc.settings.saveWorkspacePreferences.useMutation();
  const [readError, setReadError] = useState(false);
  const [reading, setReading] = useState(0);
  const mutateAsync = async (patch: Partial<WorkspacePreferences>) => {
    setReading((count) => count + 1);
    setReadError(false);

    try {
      const current = await rpc.settings.workspacePreferences.read({});

      return await write.mutateAsync({ ...current, ...patch });
    } catch (error) {
      setReadError(true);

      throw error;
    } finally {
      setReading((count) => count - 1);
    }
  };

  return {
    query,
    mutation: {
      ...write,
      isPending: reading > 0 || write.isPending,
      isError: readError || write.isError,
      reset: () => {
        setReadError(false);
        write.reset();
      },
      mutateAsync,
      mutate: (patch: Partial<WorkspacePreferences>) => {
        void mutateAsync(patch).catch(() => {});
      }
    }
  };
}
