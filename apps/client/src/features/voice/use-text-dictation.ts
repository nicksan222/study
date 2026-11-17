import { useRef } from 'react';
import type { RefObject } from 'react';

import { insertTranscript } from './text-insertion';
import type { TextSelection } from './text-insertion';

/** Captures the destination before the microphone button takes keyboard focus. */
export function useTextDictation({
  value,
  onChange,
  input,
  maxLength
}: {
  value: string;
  onChange: (value: string) => void;
  input: RefObject<HTMLTextAreaElement | null>;
  maxLength?: number;
}) {
  const selection = useRef<TextSelection | undefined>(undefined);

  return {
    onCaptureStart: () => {
      selection.current = {
        value,
        start: input.current?.selectionStart ?? value.length,
        end: input.current?.selectionEnd ?? value.length
      };
    },
    onTranscript: (transcript: string) => {
      const next = insertTranscript(value, transcript, selection.current, maxLength);

      onChange(next.value);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(next.caret, next.caret);
      });
    }
  };
}
