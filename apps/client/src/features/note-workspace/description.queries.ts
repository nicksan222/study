import type { ChatMessage } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useState } from 'react';

/** Saves optional card metadata without creating a new content version. */
export function useDescription(message: ChatMessage) {
  const [text, setText] = useState(message.description ?? '');
  const [expected] = useState(message.description ?? null);
  const operation = rpc.notes.updateMessageDescription.useMutation();
  const mutation = {
    ...operation,
    mutate: () =>
      operation.mutate({
        messageId: message.id,
        description: text.trim() || null,
        expectedDescription: expected
      }),
    mutateAsync: () =>
      operation.mutateAsync({
        messageId: message.id,
        description: text.trim() || null,
        expectedDescription: expected
      })
  };

  return { text, setText, mutation };
}
