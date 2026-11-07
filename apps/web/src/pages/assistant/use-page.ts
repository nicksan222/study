import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useAssistant } from '#web/features/assistant/index.ts';

/** Owns composer focus and keyboard submission while the application retains the conversation. */
export function usePage() {
  const conversation = useAssistant();
  const [cardVisible, setCardVisible] = useState(false);
  const historyPanel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (cardVisible) historyPanel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [cardVisible]);
  const input = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const inputId = useId();
  const send = () => {
    if (conversation.send()) input.current?.focus();
  };

  return {
    ...conversation,
    historyPanel,
    selectChat: (id: Parameters<typeof conversation.selectChat>[0]) => {
      conversation.selectChat(id);
      setCardVisible(false);
    },
    cardVisible,
    setCardVisible,
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
