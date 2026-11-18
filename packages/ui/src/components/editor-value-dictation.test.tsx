import { test } from '@study/testing';
import { createRef, useEffect } from 'react';
import type { ReactNode, RefObject } from 'react';

import { RichNoteEditor } from './rich-note';
import type { RichNoteEditorHandle, RichNoteLabels } from './rich-note';
import { StructuredEditor } from './structured-editor';
import type { StructuredEditorLabels } from './structured-editor-types';

const labels = new Proxy({} as RichNoteLabels & StructuredEditorLabels, {
  get: (_, key) => String(key)
});

type Props = {
  value: string;
  ref: RefObject<RichNoteEditorHandle | null>;
  onChange: (value: string) => void;
  toolbarEnd: ReactNode;
};

const variants = [
  {
    name: 'Markdown',
    render: (props: Props) => (
      <RichNoteEditor {...props} label="Document" placeholder="" labels={labels} />
    )
  },
  {
    name: 'structured',
    render: ({ value, onChange, ...props }: Props) => (
      <StructuredEditor
        {...props}
        value={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }]
        }}
        onChange={(next) => onChange(next.content?.[0]?.content?.[0]?.text ?? '')}
        label="Document"
        placeholder=""
        labels={labels}
      />
    )
  }
];

/** Mirrors a dictation control's descendant passive-effect publication boundary. */
function CompletedDictation({
  target,
  transcript,
  changed
}: {
  target: Props['ref'];
  transcript?: string;
  changed: boolean;
}) {
  useEffect(() => {
    if (!transcript) return;

    target.current!.restoreSelection(
      changed
        ? { kind: 'text', anchor: Number.MAX_SAFE_INTEGER, head: Number.MAX_SAFE_INTEGER }
        : { kind: 'text', anchor: 8, head: 16 }
    );
    target.current!.insertPlainText(transcript);
  }, [target, transcript, changed]);

  return null;
}

for (const variant of variants) {
  for (const changed of [false, true]) {
    test.unit.stable(
      `${variant.name} retains dictation and ${changed ? 'the latest canonical document' : 'the captured selection'} in the same commit`,
      ({ render, screen, expect }) => {
        const ref = createRef<RichNoteEditorHandle>();
        const saved: string[] = [];
        const props = {
          ref,
          value: 'Before selected after',
          onChange: (value: string) => {
            saved.push(value);
          },
          toolbarEnd: <CompletedDictation target={ref} changed={changed} />
        };
        const view = render(variant.render(props));

        view.rerender(
          variant.render({
            ...props,
            value: changed ? 'Latest canonical text' : props.value,
            toolbarEnd: (
              <CompletedDictation target={ref} changed={changed} transcript="Spoken update" />
            )
          })
        );
        const expected = changed
          ? 'Latest canonical text Spoken update'
          : 'Before Spoken update after';

        expect(saved).toEqual([expected]);
        expect(screen.getByRole('textbox', { name: 'Document' })).toHaveTextContent(expected);
      }
    );
  }
}
