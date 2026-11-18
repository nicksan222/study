import { test } from '@study/testing';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { createRef } from 'react';
import type { RefObject } from 'react';

import { RichNoteEditor } from './rich-note';
import type { RichNoteEditorHandle, RichNoteLabels } from './rich-note';
import { StructuredEditor } from './structured-editor';
import type { StructuredEditorLabels } from './structured-editor-types';

const labels = new Proxy({} as RichNoteLabels & StructuredEditorLabels, {
  get: (_, key) => String(key)
});

type Props = { ref: RefObject<RichNoteEditorHandle | null>; replacement?: string };

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

function SelectionTarget({ handle, replacement }: { handle: Props['ref']; replacement?: boolean }) {
  const content = replacement
    ? [paragraph('KEEP ME')]
    : [
        {
          type: 'table',
          attrs: { blockId: 'original' },
          content: [
            { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('x')] }] }
          ]
        }
      ];

  return (
    <StructuredEditor
      ref={handle}
      value={{ type: 'doc', content }}
      onChange={() => {}}
      label="Document"
      placeholder=""
      labels={labels}
    />
  );
}

test.unit.stable(
  'rejects the selected table position when a paragraph of the same size replaces it',
  ({ render, screen, act, expect }) => {
    const handle = createRef<RichNoteEditorHandle>();
    const view = render(<SelectionTarget handle={handle} />);
    const editor = (
      screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & { editor: Editor }
    ).editor;

    act(() => editor.commands.setNodeSelection(0));
    const captured = handle.current!.selection();

    expect(captured).toMatchObject({ kind: 'node', anchor: 0, head: 9 });
    view.rerender(<SelectionTarget handle={handle} replacement />);
    expect(editor.state.doc.firstChild?.nodeSize).toBe(9);
    act(() => {
      handle.current!.restoreSelection(captured);
      handle.current!.insertPlainText('Spoken after');
    });
    expect(editor.state.doc.textContent).toBe('KEEP ME Spoken after');
  }
);

const variants = [
  {
    name: 'Markdown rule',
    node: 'horizontalRule',
    render: ({ ref, replacement }: Props) => (
      <RichNoteEditor
        ref={ref}
        value={replacement ?? 'Before\n\n---\n\nAfter'}
        onChange={() => {}}
        label="Document"
        placeholder=""
        labels={labels}
      />
    )
  },
  {
    name: 'structured image',
    node: 'image',
    render: ({ ref, replacement }: Props) => (
      <StructuredEditor
        ref={ref}
        value={{
          type: 'doc',
          content: replacement
            ? [paragraph(replacement)]
            : [
                paragraph('Before'),
                {
                  type: 'image',
                  attrs: {
                    sourceId: '17',
                    revision: 1,
                    src: 'data:image/png;base64,',
                    alt: 'Diagram'
                  }
                },
                paragraph('After')
              ]
        }}
        onChange={() => {}}
        label="Document"
        placeholder=""
        labels={labels}
      />
    )
  }
];

for (const variant of variants) {
  test.unit.stable(
    `dictation preserves the captured ${variant.name} node after focus loss`,
    ({ render, screen, act, expect }) => {
      const ref = createRef<RichNoteEditorHandle>();

      render(
        <>
          {variant.render({ ref })}
          <button>Other control</button>
        </>
      );
      const editor = (
        screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & { editor: Editor }
      ).editor;

      act(() => {
        editor.commands.setNodeSelection(8);
      });
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
      const captured = ref.current!.selection();

      act(() => {
        editor.commands.setTextSelection(1);
        screen.getByRole('button', { name: 'Other control' }).focus();
        ref.current!.restoreSelection(captured);
        ref.current!.insertPlainText('Spoken after');
      });
      const document = editor.getJSON();

      expect(document.content?.map((node) => node.type)).toEqual([
        'paragraph',
        variant.node,
        'paragraph',
        'paragraph'
      ]);
      expect(editor.state.doc.child(0).textContent).toBe('Before');
      expect(editor.state.doc.child(2).textContent).toBe('Spoken after');
      expect(editor.state.doc.child(3).textContent).toBe('After');
      expect(captured).toMatchObject({ kind: 'node' });
    }
  );

  for (const replacement of ['New canonical document', 'New']) {
    test.unit.stable(
      `an invalid captured ${variant.name} position safely appends to ${JSON.stringify(replacement)}`,
      ({ render, screen, act, expect }) => {
        const ref = createRef<RichNoteEditorHandle>();
        const view = render(variant.render({ ref }));
        const editor = (
          screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & { editor: Editor }
        ).editor;

        act(() => {
          editor.commands.setNodeSelection(8);
        });
        const captured = ref.current!.selection();

        view.rerender(variant.render({ ref, replacement }));
        act(() => {
          ref.current!.restoreSelection(captured);
          ref.current!.insertPlainText('Spoken after');
        });
        expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['paragraph']);
        expect(editor.state.doc.textContent).toBe(replacement + ' Spoken after');
      }
    );
  }
}
