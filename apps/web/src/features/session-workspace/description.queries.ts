import type { ChatMessage } from '@study/contracts/conversations/messages';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '../../lib/study-client/request';
import { sessionKey } from './session-workspace.queries';

/** Saves optional card metadata without creating a new content version. */
export function useDescription(message: ChatMessage) {
  const cache = useQueryClient();
  const [text, setText] = useState(message.description ?? '');
  const [expected] = useState(message.description ?? null);
  const mutation = useMutation({
    mutationFn: () =>
      request((rpc) =>
        rpc['conversations.updateMessageDescription']({
          messageId: message.id,
          description: text.trim() || null,
          expectedDescription: expected
        })
      ),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: [...sessionKey(message.sessionId), 'thread'] });
    }
  });

  return { text, setText, mutation };
}
