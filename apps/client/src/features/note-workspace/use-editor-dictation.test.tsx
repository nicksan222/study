import { test } from '@study/testing';
import { RichNoteEditor } from '@study/ui';
import type { RichNoteEditorHandle, RichNoteLabels, RichNoteSelection } from '@study/ui';
import { useRef, useState } from 'react';

import { useEditorDictation } from './use-editor-dictation';

const labels = new Proxy({} as RichNoteLabels, { get: (_, key) => String(key) });

function LiveNote({ kind = 'text' }: { kind?: RichNoteSelection['kind'] }) {
  const editor = useRef<RichNoteEditorHandle>(null);
  const [value, setValue] = useState(kind === 'text' ? 'Before replace after' : '---\n\n---');
  const dictation = useEditorDictation(editor, value);

  return (
    <>
      <RichNoteEditor
        ref={editor}
        value={value}
        onChange={setValue}
        label="Note"
        placeholder=""
        labels={labels}
      />
      <button
        onClick={() => {
          editor.current!.restoreSelection(
            kind === 'text'
              ? { kind, anchor: 8, head: 16 }
              : { kind, anchor: 0, head: 1, nodeType: 'horizontalRule' }
          );
          dictation.onCaptureStart();
        }}
      >
        Capture selection
      </button>
      <button onClick={() => dictation.onTranscript('first')}>First segment</button>
      <button onClick={() => dictation.onTranscript(', second')}>Second segment</button>
      <button>Another control</button>
    </>
  );
}

test.unit.stable(
  'replaces the rich note selection once and continues at the live caret without stealing focus',
  async ({ render, screen, fireEvent, act, expect }) => {
    render(<LiveNote />);
    const note = screen.getByRole('textbox', { name: 'Note' });
    const other = screen.getByRole('button', { name: 'Another control' });

    fireEvent.click(screen.getByRole('button', { name: 'Capture selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'First segment' }));
    expect(note).toHaveTextContent('Before first after');
    await act(async () => {
      await new Promise<void>((ready) => requestAnimationFrame(() => ready()));
      other.focus();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Second segment' }));
    expect(note).toHaveTextContent('Before first, second after');
    expect(other).toHaveFocus();
  }
);

for (const kind of ['text', 'node'] as const) {
  test.unit.stable(
    `keeps outside focus while delivering the first segment to a captured ${kind} selection`,
    async ({ render, screen, fireEvent, act, expect }) => {
      render(<LiveNote kind={kind} />);
      const note = screen.getByRole('textbox', { name: 'Note' });
      const other = screen.getByRole('button', { name: 'Another control' });

      fireEvent.click(screen.getByRole('button', { name: 'Capture selection' }));
      other.focus();
      fireEvent.click(screen.getByRole('button', { name: 'First segment' }));
      await act(async () => {
        await new Promise<void>((ready) => requestAnimationFrame(() => ready()));
      });
      expect(other).toHaveFocus();
      expect(note).toHaveTextContent(kind === 'text' ? 'Before first after' : 'first');

      if (kind === 'node') expect(note.querySelectorAll('hr')).toHaveLength(2);
    }
  );
}
