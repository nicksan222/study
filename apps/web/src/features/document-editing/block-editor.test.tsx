import { createBlock } from '@study/contracts/sources/document';
import { canonicalText } from '@study/contracts/sources/schemas';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vite-plus/test';

import { BlockEditor, authoredCopy, blankDocument } from './block-editor';

it('edits a text run without flattening marks, links or neighboring structures', async () => {
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
      { depth: 1, ordered: true, start: 4, inlines: [{ type: 'text', text: 'Nested', marks: [] }] }
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

  render(<Harness />);
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
});

it('gives independent copies fresh authored identities while preserving rich content', () => {
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
});
