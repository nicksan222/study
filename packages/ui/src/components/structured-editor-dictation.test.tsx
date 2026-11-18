import { test } from '@study/testing';
import type { TiptapEditorHTMLElement } from '@tiptap/core';
import { createRef } from 'react';

import type { RichNoteEditorHandle } from './rich-note';
import { StructuredEditor } from './structured-editor';
import type { StructuredEditorValue } from './structured-editor';
import type { StructuredEditorLabels } from './structured-editor-types';

const labels = new Proxy({} as StructuredEditorLabels, { get: (_, key) => String(key) });

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

const table = {
  type: 'table',
  content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('Cell')] }] }]
};

function tableRow(...cells: string[]) {
  return {
    type: 'tableRow',
    content: cells.map((text) => ({ type: 'tableCell', content: [paragraph(text)] }))
  };
}

for (const mode of ['forward', 'backward', 'live'] as const) {
  test.unit.stable(
    `preserves the table when dictating into a ${mode} column selection`,
    ({ render, screen, act, expect }) => {
      const handle = createRef<RichNoteEditorHandle>();
      let changed: StructuredEditorValue | undefined;
      const backwards = mode === 'backward';

      render(
        <StructuredEditor
          ref={handle}
          value={{
            type: 'doc',
            content: [
              { type: 'table', content: [tableRow('A', 'B'), tableRow('C', 'D')] },
              paragraph('After the table')
            ]
          }}
          onChange={(value) => {
            changed = value;
          }}
          label="Document"
          placeholder=""
          labels={labels}
        />
      );
      const root = screen.getByRole('textbox', { name: 'Document' }) as TiptapEditorHTMLElement;
      const editor = root.editor!;
      const cells = root.querySelectorAll('td');
      const cellB = editor.view.posAtDOM(cells[1]!, 0) - 1;
      const cellD = editor.view.posAtDOM(cells[3]!, 0) - 1;

      act(() => {
        editor.commands.setCellSelection({
          anchorCell: backwards ? cellD : cellB,
          headCell: backwards ? cellB : cellD
        });
        expect(
          [...root.querySelectorAll('td.selectedCell')].map((cell) => cell.textContent)
        ).toEqual(['B', 'D']);

        if (mode !== 'live') {
          const captured = handle.current!.selection();

          editor.commands.setTextSelection(4);
          handle.current!.restoreSelection(captured, { focus: false });
        }

        handle.current!.insertPlainText('Spoken', { focus: false });
        handle.current!.insertPlainText('words', { continuation: true });
      });

      expect(changed?.content).toMatchObject([
        {
          type: 'table',
          content: [
            tableRow('A', backwards ? 'B Spoken words' : 'B'),
            tableRow('C', backwards ? 'D' : 'D Spoken words')
          ]
        },
        paragraph('After the table')
      ]);
    }
  );
}

for (const block of [table, { type: 'documentMath', content: [{ type: 'text', text: 'x+y' }] }]) {
  test.unit.stable(
    `appends a new paragraph after an untouched trailing ${block.type}`,
    ({ render, act, expect }) => {
      const handle = createRef<RichNoteEditorHandle>();
      let changed: StructuredEditorValue | undefined;

      render(
        <StructuredEditor
          ref={handle}
          value={{ type: 'doc', content: [paragraph('Earlier text'), block] }}
          onChange={(value) => {
            changed = value;
          }}
          label="Document"
          placeholder=""
          labels={labels}
        />
      );
      act(() => {
        handle.current!.restoreSelection({
          kind: 'text',
          anchor: Number.MAX_SAFE_INTEGER,
          head: Number.MAX_SAFE_INTEGER
        });
        handle.current!.insertPlainText('New transcript', { append: true });
      });
      expect(changed?.content).toMatchObject([
        paragraph('Earlier text'),
        block,
        paragraph('New transcript')
      ]);
    }
  );
}

for (const inline of [false, true]) {
  test.unit.stable(
    `preserves dictated newlines inside ${inline ? 'inline' : 'block'} math`,
    ({ render, act, expect }) => {
      const handle = createRef<RichNoteEditorHandle>();
      let changed: StructuredEditorValue | undefined;
      const math = {
        type: inline ? 'documentInlineMath' : 'documentMath',
        content: [{ type: 'text', text: 'Before selected after' }]
      };

      render(
        <StructuredEditor
          ref={handle}
          value={{
            type: 'doc',
            content: inline ? [{ type: 'paragraph', content: [math] }] : [math]
          }}
          onChange={(value) => {
            changed = value;
          }}
          label="Document"
          placeholder=""
          labels={labels}
        />
      );
      act(() => {
        const offset = inline ? 1 : 0;

        handle.current!.restoreSelection({ kind: 'text', anchor: 8 + offset, head: 16 + offset });
        handle.current!.insertPlainText('first\r\nsecond\rthird\n\nlast');
      });
      const result = inline ? changed?.content?.[0]?.content?.[0] : changed?.content?.[0];

      expect(result).toMatchObject({
        type: math.type,
        content: [{ type: 'text', text: 'Before first\nsecond\nthird\n\nlast after' }]
      });
    }
  );
}

test.unit.stable(
  'appends dictation after a trailing image when the captured document changed',
  ({ render, screen, act, expect }) => {
    const handle = createRef<RichNoteEditorHandle>();
    let changed: StructuredEditorValue | undefined;

    render(
      <StructuredEditor
        ref={handle}
        value={{
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
            {
              type: 'image',
              attrs: {
                src: 'data:image/png;base64,',
                sourceId: '17',
                revision: 1,
                alt: 'Last image'
              }
            }
          ]
        }}
        onChange={(value) => {
          changed = value;
        }}
        label="Document"
        placeholder=""
        labels={labels}
      />
    );
    expect(screen.getByAltText('Last image')).toBeInTheDocument();
    act(() => {
      handle.current!.restoreSelection({
        kind: 'text',
        anchor: Number.MAX_SAFE_INTEGER,
        head: Number.MAX_SAFE_INTEGER
      });
      handle.current!.insertPlainText('Spoken after');
    });
    expect(changed?.content?.map((node) => node.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(changed?.content?.[0]?.content?.[0]?.text).toBe('Before');
    expect(changed?.content?.[2]?.content?.[0]?.text).toBe('Spoken after');
  }
);
