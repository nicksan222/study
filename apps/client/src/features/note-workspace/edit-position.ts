import type { RichNoteEditorHandle, RichNoteSelection } from '@study/ui';
import { useCallback, useLayoutEffect, useRef } from 'react';

export type EditPosition = {
  scroll: number;
  inputScroll: number;
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
  source?: boolean;
  rich?: RichNoteSelection;
};

const initialEditPosition = (): EditPosition => ({
  scroll: 0,
  inputScroll: 0,
  start: 0,
  end: 0,
  direction: 'none'
});

export function useEditPosition(saved: EditPosition | undefined) {
  const body = useRef<HTMLDivElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const richEditor = useRef<RichNoteEditorHandle>(null);
  const position = useRef(initialEditPosition());
  const recording = useRef(false);
  const switching = useRef(false);
  const source = saved?.source === true;
  const restorePosition = useCallback(() => {
    const { current } = position;
    const input = textInput.current;

    if (input) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(current.start, current.end, current.direction);
      input.scrollTop = current.inputScroll;
    } else {
      body.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus({
        preventScroll: true
      });

      if (current.rich) richEditor.current?.restoreSelection(current.rich);
    }

    if (body.current) body.current.scrollTop = current.scroll;
  }, []);

  useLayoutEffect(() => {
    if (!switching.current) return;

    switching.current = false;
    restorePosition();
  }, [restorePosition, source]);

  const capture = () => {
    // Read the DOM before closing. Caret scrolling can precede queued scroll and select events.
    if (body.current) position.current.scroll = body.current.scrollTop;

    const input = textInput.current;

    if (input) {
      position.current.start = input.selectionStart;
      position.current.end = input.selectionEnd;
      position.current.direction = input.selectionDirection;
      position.current.inputScroll = input.scrollTop;
    }

    if (richEditor.current) position.current.rich = richEditor.current.selection();
  };

  return {
    body,
    textInput,
    richEditor,
    source,
    restore: (): false => {
      position.current = { ...(saved ?? initialEditPosition()) };
      recording.current = true;
      restorePosition();

      return false;
    },
    pause: () => {
      capture();
      recording.current = false;

      return { ...position.current };
    },
    switchMode: () => {
      capture();
      position.current.source = !source;
      switching.current = true;

      return { ...position.current };
    },
    recordScroll: (scroll: number) => {
      if (recording.current) position.current.scroll = scroll;
    },
    recordSelection: ({ selectionStart, selectionEnd }: HTMLTextAreaElement) => {
      if (!recording.current) return;

      position.current.start = selectionStart;
      position.current.end = selectionEnd;
    },
    reset: () => {
      position.current = initialEditPosition();
      recording.current = false;
    }
  };
}
