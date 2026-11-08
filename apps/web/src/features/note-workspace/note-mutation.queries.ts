import type { NoteId } from '@study/contracts/ids';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { noteKey } from './note-workspace.queries';

/** Refreshes committed note state even when a mutation's transport outcome is uncertain. */
export function useNoteMutation<Variables, Output>(
  noteId: NoteId,
  mutationFn: (variables: Variables) => Promise<Output>
) {
  const cache = useQueryClient();

  return useMutation({
    mutationFn,
    onSettled: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: noteKey(noteId) }),
        cache.invalidateQueries({ queryKey: ['notes'] })
      ]);
    }
  });
}
