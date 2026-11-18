import { createBlock, canonicalText } from '@study/contracts';
import { test } from '@study/testing';
import { useState } from 'react';

import { BlockEditor, authoredCopy, blankDocument } from './block-editor';

test.unit.stable(
  'edits a text run without flattening marks, links or neighboring structures',
  async ({ react, rpc, screen, userEvent, expect }) => {
    rpc.givenWorkspace();
    const paragraph = createBlock({
      type: 'paragraph',
      inlines: [
        { type: 'text', text: 'Bold', marks: ['strong'] },
        { type: 'link', text: 'Reference', href: 'https://example.com' }
      ]
    });
    const table = createBlock({
      type: 'table',
      rows: [
        {
          cells: [
            { header: true, paragraphs: [[{ type: 'text', text: 'Cell', marks: ['emphasis'] }]] }
          ]
        }
      ]
    });
    const list = createBlock({
      type: 'list_item',
      items: [
        {
          depth: 1,
          ordered: true,
          start: 4,
          inlines: [{ type: 'text', text: 'Nested', marks: [] }]
        }
      ]
    });
    let latest = { ...blankDocument(), blocks: [paragraph, table, list] };

    function Harness() {
      const [document, change] = useState(latest);

      return (
        <BlockEditor
          document={document}
          change={(value) => {
            latest = value;
            change(value);
          }}
        />
      );
    }

    react.render(<Harness />);
    const input = screen.getAllByRole('textbox')[0]!;
    const user = userEvent.setup();

    await user.clear(input);
    await user.type(input, 'Changed');
    expect(latest.blocks[0]!.id).toBe(paragraph.id);
    expect(latest.blocks[0]!.content).toEqual({
      type: 'paragraph',
      inlines: [
        { type: 'text', text: 'Changed', marks: ['strong'] },
        { type: 'link', text: 'Reference', href: 'https://example.com' }
      ]
    });
    expect(latest.blocks[0]!.text).toBe(canonicalText(latest.blocks[0]!.content));
    expect(latest.blocks.slice(1)).toEqual([table, list]);
  }
);

test.unit.stable(
  'gives independent copies fresh authored identities while preserving rich content',
  ({ expect }) => {
    const block = createBlock(
      { type: 'code', code: 'const n = 1;', language: 'ts' },
      { type: 'authored' }
    );
    const document = { ...blankDocument(), blocks: [block] };
    const copy = authoredCopy(document);

    expect(copy.blocks[0]!.id).not.toBe(block.id);
    expect(copy.blocks[0]!.content).toEqual(block.content);
    expect(copy.blocks[0]!.anchor).toEqual({ type: 'authored' });
    expect(document.blocks[0]!.id).toBe(block.id);
  }
);

test.unit.stable(
  'offers dictation for editable prose while keeping code and formulas as manual fields',
  async ({ react, rpc, screen, expect, within }) => {
    rpc.givenWorkspace();
    const document = {
      ...blankDocument(),
      blocks: [
        createBlock({ type: 'paragraph', inlines: [{ type: 'text', text: 'Prose', marks: [] }] }),
        createBlock({ type: 'code', code: 'const x = 1;', language: 'typescript' }),
        createBlock({ type: 'math', expression: 'x=1' })
      ]
    };

    react.render(<BlockEditor document={document} change={() => {}} />);
    const microphone = { name: /Dictation requires microphone/ };
    const paragraph = within(screen.getByRole('group', { name: 'Block 1' }));
    const code = within(screen.getByRole('group', { name: 'Block 2' }));
    const math = within(screen.getByRole('group', { name: 'Block 3' }));

    expect(paragraph.getByRole('button', microphone)).toBeInTheDocument();
    expect(code.queryByRole('button', microphone)).not.toBeInTheDocument();
    expect(math.queryByRole('button', microphone)).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
  }
);
