import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { insertTranscript, textareaValue } from './text-insertion';
import type { TextSelection } from './text-insertion';

type Destination = {
  pendingAgainst?: string;
  selection: TextSelection;
  initialFocus?: Element;
};

/** Textarea offsets count a CRLF pair as one character. */
function rawOffset(value: string, offset: number) {
  if (!value.includes('\r\n')) return offset;

  let position = 0;

  for (let index = 0; index < offset && position < value.length; index++, position++) {
    if (value[position] === '\r' && value[position + 1] === '\n') position++;
  }

  return position;
}

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
  const destination = useRef<Destination | undefined>(undefined);

  useLayoutEffect(() => {
    if (destination.current) destination.current.pendingAgainst = undefined;
  }, [value]);

  return {
    onCaptureStart: () => {
      destination.current = {
        selection: {
          value,
          start: input.current ? rawOffset(value, input.current.selectionStart) : value.length,
          end: input.current ? rawOffset(value, input.current.selectionEnd) : value.length
        },
        initialFocus: input.current?.ownerDocument.activeElement ?? undefined
      };
    },
    onTranscript: (transcript: string) => {
      const previous = destination.current;
      // Multiple segments can arrive before React commits the first insertion.
      const current = previous?.pendingAgainst === value ? previous.selection.value : value;
      const next = insertTranscript(current, transcript, previous?.selection, maxLength);
      const field = input.current;
      const active = field?.ownerDocument.activeElement;
      const initialFocus = previous?.initialFocus;
      const landed: Destination = {
        pendingAgainst: value,
        selection: { value: next.value, start: next.caret, end: next.caret },
        initialFocus: active === initialFocus ? initialFocus : undefined
      };

      onChange(next.value);
      destination.current = landed;

      if (!field || (active !== field && !landed.initialFocus)) return;

      requestAnimationFrame(() => {
        if (destination.current !== landed || input.current !== field) return;

        landed.initialFocus = undefined;

        if (
          field.value !== textareaValue(next.value) ||
          field.ownerDocument.activeElement !== active
        )
          return;

        const caret = textareaValue(next.value.slice(0, next.caret)).length;

        field.focus();
        field.setSelectionRange(caret, caret);
      });
    }
  };
}
