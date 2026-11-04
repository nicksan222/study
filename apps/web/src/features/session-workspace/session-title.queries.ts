import type { SessionId } from '@study/contracts/ids';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

import { sessionOptions } from './session-workspace.queries';

export function useSessionTitle(id: SessionId) {
  const cache = useQueryClient();

  return useMutation({
    mutationKey: ['session-workspace', String(id), 'rename'],
    mutationFn: (title: string) =>
      request((client) => client['conversations.renameSession']({ id, title })),
    onSuccess: (session) => {
      cache.setQueryData(sessionOptions(id).queryKey, session);
      void cache.invalidateQueries({ queryKey: ['sessions'] });
      void cache.invalidateQueries({ queryKey: ['search'] });
    }
  });
}
