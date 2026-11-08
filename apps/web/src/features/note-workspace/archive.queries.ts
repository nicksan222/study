import type { MessageId, NoteId } from '@study/contracts/ids';
import type { NoteArchiveTarget } from '@study/contracts/notes/archive';
import { toastManager } from '@study/ui/toast';
import { queryOptions, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';

import { useI18n } from '#web/lib/i18n.tsx';
import { request } from '#web/lib/study-client/request.ts';

import { noteKey } from './note-workspace.queries';

export const archivedItemsOptions = (noteId: NoteId) =>
  queryOptions({
    queryKey: [...noteKey(noteId), 'archived'],
    queryFn: ({ signal }) => request((rpc) => rpc['notes.archivedItems']({ noteId }), signal)
  });

export const archivedMessageOptions = (id: MessageId) =>
  queryOptions({
    queryKey: ['note-archive-message', String(id)],
    queryFn: ({ signal }) => request((rpc) => rpc['notes.message']({ id }), signal)
  });

/** Membership changes are idempotent; every mounted instance shares the pending fence. */
export function useItemArchive(noteId: NoteId, target: NoteArchiveTarget) {
  const cache = useQueryClient();
  const { t } = useI18n();
  const mutationKey = [...noteKey(noteId), 'archive', target.kind, String(target.id)];
  const pending = useIsMutating({ mutationKey, exact: true }) > 0;
  const mutation = useMutation({
    mutationKey,
    retry: false,
    mutationFn: (archived: boolean) =>
      request((rpc) => rpc['notes.setItemArchived']({ noteId, target, archived })),
    onError: () => {
      toastManager.add({
        title: t('NoteActionErrorTitle'),
        description: t('NoteRequestError'),
        type: 'error'
      });
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: noteKey(noteId) }),
        cache.invalidateQueries({ queryKey: ['pages', 'note', String(noteId)] }),
        cache.invalidateQueries({ queryKey: ['notes'] })
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
