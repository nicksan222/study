import { createBlock, canonicalText } from '@study/contracts';
import { test } from '@study/testing';
import { useState } from 'react';

import { BlockEditor, authoredCopy, blankDocument } from './block-editor';

test.stable(
  'edits a text run without flattening marks, links or neighboring structures',
  async () => {
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

    test.render(<Harness />);
    const input = test.screen.getAllByRole('textbox')[0]!;
    const user = test.userEvent.setup();

    await user.clear(input);
    await user.type(input, 'Changed');
    test.expect(latest.blocks[0]!.id).toBe(paragraph.id);
    test.expect(latest.blocks[0]!.content).toEqual({
      type: 'paragraph',
      inlines: [
        { type: 'text', text: 'Changed', marks: ['strong'] },
        { type: 'link', text: 'Reference', href: 'https://example.com' }
      ]
    });
    test.expect(latest.blocks[0]!.text).toBe(canonicalText(latest.blocks[0]!.content));
    test.expect(latest.blocks.slice(1)).toEqual([table, list]);
  }
);

test.stable(
  'gives independent copies fresh authored identities while preserving rich content',
  () => {
    const block = createBlock(
      { type: 'code', code: 'const n = 1;', language: 'ts' },
      { type: 'authored' }
    );
    const document = { ...blankDocument(), blocks: [block] };
    const copy = authoredCopy(document);

    test.expect(copy.blocks[0]!.id).not.toBe(block.id);
    test.expect(copy.blocks[0]!.content).toEqual(block.content);
    test.expect(copy.blocks[0]!.anchor).toEqual({ type: 'authored' });
    test.expect(document.blocks[0]!.id).toBe(block.id);
  }
);
