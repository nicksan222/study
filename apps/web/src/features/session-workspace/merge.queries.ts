import type { mergeSessionsInputSchema } from '@study/contracts/conversations/rpc';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

import { sessionOptions } from './session-workspace.queries';

export function useSessionMerge() {
  const cache = useQueryClient();

  return useMutation({
    mutationKey: ['sessions', 'merge'],
    retry: false,
    mutationFn: (input: typeof mergeSessionsInputSchema.Type) =>
      request((rpc) => rpc['conversations.mergeSessions'](input)),
    onSuccess: async (session) => {
      cache.setQueryData(sessionOptions(session.id).queryKey, session);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['sessions'] }),
        cache.invalidateQueries({ queryKey: ['session-workspace'] }),
        cache.invalidateQueries({ queryKey: ['search'] })
      ]);
    }
  });
}
