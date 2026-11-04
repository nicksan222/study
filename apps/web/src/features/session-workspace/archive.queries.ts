import type { SessionArchiveTarget } from '@study/contracts/conversations/archive';
import type { SessionId } from '@study/contracts/ids';
import { toastManager } from '@study/ui/toast';
import { queryOptions, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';

import { useI18n } from '#web/lib/i18n.tsx';
import { request } from '#web/lib/study-client/request.ts';

import { sessionKey } from './session-workspace.queries';

export const archivedItemsOptions = (sessionId: SessionId) =>
  queryOptions({
    queryKey: [...sessionKey(sessionId), 'archived'],
    queryFn: ({ signal }) =>
      request((rpc) => rpc['conversations.archivedItems']({ sessionId }), signal)
  });

/** Membership changes are idempotent; every mounted instance shares the pending fence. */
export function useItemArchive(sessionId: SessionId, target: SessionArchiveTarget) {
  const cache = useQueryClient();
  const { t } = useI18n();
  const mutationKey = [...sessionKey(sessionId), 'archive', target.kind, String(target.id)];
  const pending = useIsMutating({ mutationKey, exact: true }) > 0;
  const mutation = useMutation({
    mutationKey,
    retry: false,
    mutationFn: (archived: boolean) =>
      request((rpc) => rpc['conversations.setItemArchived']({ sessionId, target, archived })),
    onError: () => {
      toastManager.add({
        title: t('SessionActionErrorTitle'),
        description: t('SessionRequestError'),
        type: 'error'
      });
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: sessionKey(sessionId) }),
        cache.invalidateQueries({ queryKey: ['documents', 'session', String(sessionId)] }),
        cache.invalidateQueries({ queryKey: ['sessions'] })
      ]);
    }
  });
  return {
    pending,
    error: mutation.error,
    change: (archived: boolean) => {
      if (cache.isMutating({ mutationKey, exact: true })) return;
      mutation.mutate(archived);
    }
  };
}
