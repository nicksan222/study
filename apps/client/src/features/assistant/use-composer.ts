import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { useDictationSubmission } from '#client/features/voice/index.ts';

import type { useAssistant } from './use-assistant';

export function useAssistantComposer(note: Pick<ReturnType<typeof useAssistant>, 'send'>) {
  const input = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const inputId = useId();
  const submission = useDictationSubmission();
  const send = () => {
    if (submission.isBlocked()) return false;

    const sent = note.send();

    if (sent) input.current?.focus();

    return sent;
  };

  return {
    input,
    hintId,
    inputId,
    submission,
    send,
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

      event.preventDefault();
      send();
    }
  };
}
