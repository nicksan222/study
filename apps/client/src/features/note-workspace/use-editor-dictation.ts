import { StudyError } from '@study/contracts';
import type { RichNoteEditorHandle, RichNoteSelection } from '@study/ui';
import { useRef } from 'react';
import type { RefObject } from 'react';

const documentEnd: RichNoteSelection = {
  kind: 'text',
  anchor: Number.MAX_SAFE_INTEGER,
  head: Number.MAX_SAFE_INTEGER
};

/** Applies the first segment to the captured selection, then follows the live editor. */
export function useEditorDictation<Value>(
  editor: RefObject<RichNoteEditorHandle | null>,
  value: Value,
  equals: (captured: Value, current: Value) => boolean = Object.is
) {
  const captured = useRef<{ value: Value; selection: RichNoteSelection } | undefined>(undefined);
  const continued = useRef(false);
  const initialFocus = useRef<Element | null>(null);

  return {
    onCaptureStart: () => {
      const selection = editor.current?.selection();

      captured.current = selection ? { value, selection } : undefined;
      initialFocus.current = document.activeElement;
      continued.current = false;
    },
    onTranscript: (text: string) => {
      const target = editor.current;

      if (!target) throw new StudyError('invalid_input', 'Dictation destination is unavailable');

      const continuation = continued.current;
      const focus = !continuation && document.activeElement === initialFocus.current;

      if (!continuation) {
        const original = captured.current;

        target.restoreSelection(
          original && equals(original.value, value) ? original.selection : documentEnd,
          { focus }
        );
      }

      target.insertPlainText(text, { continuation, focus });
      continued.current = true;
    }
  };
}
