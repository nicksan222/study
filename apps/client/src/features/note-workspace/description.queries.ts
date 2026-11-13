import type { ChatMessage } from '@study/contracts/notes/messages';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '#client/lib/study-client/request.ts';

import { noteKey } from './note-workspace.queries';

/** Saves optional card metadata without creating a new content version. */
export function useDescription(message: ChatMessage) {
  const cache = useQueryClient();
  const [text, setText] = useState(message.description ?? '');
  const [expected] = useState(message.description ?? null);
  const mutation = useMutation({
    mutationFn: () =>
      request((rpc) =>
        rpc['notes.updateMessageDescription']({
          messageId: message.id,
          description: text.trim() || null,
          expectedDescription: expected
        })
      ),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: [...noteKey(message.noteId), 'thread'] });
    }
  });

  return { text, setText, mutation };
}
