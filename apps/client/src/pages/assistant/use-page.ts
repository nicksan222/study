import { useEffect, useRef, useState } from 'react';

import { useAssistant, useAssistantComposer } from '#client/features/assistant/index.ts';

/** Owns composer focus and keyboard submission while the application retains the note. */
export function usePage() {
  const note = useAssistant();
  const composer = useAssistantComposer(note);
  const [cardVisible, setCardVisible] = useState(false);
  const historyPanel = useRef<HTMLElement>(null);
  const historyToggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (cardVisible) historyPanel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [cardVisible]);

  return {
    ...note,
    ...composer,
    historyPanel,
    historyToggle,
    selectChat: (id: Parameters<typeof note.selectChat>[0]) => {
      note.selectChat(id);
      setCardVisible(false);
      historyToggle.current?.focus({ preventScroll: true });
    },
    cardVisible,
    setCardVisible
  };
}
