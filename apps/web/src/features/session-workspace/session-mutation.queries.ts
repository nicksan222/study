import type { SessionId } from '@study/contracts/ids';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { sessionKey } from './session-workspace.queries';

/** Refreshes committed session state even when a mutation's transport outcome is uncertain. */
export function useSessionMutation<Variables, Output>(
  sessionId: SessionId,
  mutationFn: (variables: Variables) => Promise<Output>
) {
  const cache = useQueryClient();

  return useMutation({
    mutationFn,
    onSettled: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: sessionKey(sessionId) }),
        cache.invalidateQueries({ queryKey: ['sessions'] })
      ]);
    }
  });
}
