import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { useAssistant } from '#web/features/assistant/index.ts';

/** Owns composer focus and keyboard submission while the application retains the conversation. */
export function usePage() {
  const conversation = useAssistant();
  const input = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const inputId = useId();
  const send = () => {
    if (conversation.send()) input.current?.focus();
  };

  return {
    ...conversation,
    input,
    hintId,
    inputId,
    send,
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

      event.preventDefault();
      send();
    }
  };
}
