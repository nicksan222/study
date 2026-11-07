import { useEffect, useRef, useState } from 'react';

import { useAssistant, useAssistantComposer } from '#web/features/assistant/index.ts';

/** Owns composer focus and keyboard submission while the application retains the conversation. */
export function usePage() {
  const conversation = useAssistant();
  const composer = useAssistantComposer(conversation);
  const [cardVisible, setCardVisible] = useState(false);
  const historyPanel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (cardVisible) historyPanel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [cardVisible]);

  return {
    ...conversation,
    ...composer,
    historyPanel,
    selectChat: (id: Parameters<typeof conversation.selectChat>[0]) => {
      conversation.selectChat(id);
      setCardVisible(false);
    },
    cardVisible,
    setCardVisible
  };
}
