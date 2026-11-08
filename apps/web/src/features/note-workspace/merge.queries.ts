import type { mergeNotesInputSchema } from '@study/contracts/notes/rpc';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

import { noteOptions } from './note-workspace.queries';

export function useNoteMerge() {
  const cache = useQueryClient();

  return useMutation({
    mutationKey: ['notes', 'merge'],
    retry: false,
    mutationFn: (input: typeof mergeNotesInputSchema.Type) =>
      request((rpc) => rpc['notes.mergeNotes'](input)),
    onSuccess: async (note) => {
      cache.setQueryData(noteOptions(note.id).queryKey, note);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['notes'] }),
        cache.invalidateQueries({ queryKey: ['note-workspace'] }),
        cache.invalidateQueries({ queryKey: ['search'] })
      ]);
    }
  });
}
