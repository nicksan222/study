import { sourceIdSchema } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import type { BlockContent } from '@study/contracts/sources/schemas';
import { StructuredEditor } from '@study/ui/structured-editor';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { useState } from 'react';
import { expect, it, vi } from 'vite-plus/test';

import { blankDocument } from '../document-editing/block-editor';
import { documentToEditor, editorToDocument } from './document-editor-content';

const plain = (text: string) => [{ type: 'text' as const, text, marks: [] }];

const labels = {
  formatting: 'Format',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strike',
  paragraph: 'Normal text',
  textStyle: 'Text style',
  clear: 'Clear formatting',
  heading: 'Heading',
  subheading: 'Subheading',
  bullets: 'Bullets',
  numbered: 'Numbered',
  quote: 'Quote',
  code: 'Code',
  undo: 'Undo',
  redo: 'Redo'
};

it('retains imported rich structures, source anchors and block identity through the real editor', async () => {
  const content: BlockContent[] = [
    { type: 'heading', level: 3, inlines: [{ type: 'text', text: 'Heading', marks: ['strong'] }] },
    {
      type: 'paragraph',
      inlines: [
        { type: 'link', text: 'Read', href: 'https://example.com' },
        { type: 'break' },
        { type: 'math', text: 'x+y' }
      ]
    },
    {
      type: 'segment',
      inlines: [{ type: 'text', text: 'Transcript', marks: ['subscript', 'superscript'] }]
    },
    { type: 'reference', href: 'https://example.com/reference', inlines: plain('Reference') },
    {
      type: 'table',
      rows: [
        {
          cells: [
            { header: true, paragraphs: [plain('Title')] },
            { header: false, paragraphs: [plain('One'), plain('Two')] }
          ]
        }
      ]
    },
    {
      type: 'list_item',
      items: [
        { depth: 0, ordered: true, start: 4, inlines: plain('Fourth') },
        { depth: 1, ordered: false, start: 1, inlines: plain('Nested') },
        { depth: 0, ordered: true, start: 5, continuation: true, inlines: plain('Fifth') }
      ]
    },
    { type: 'code', code: 'const count = 1;', language: 'typescript' },
    { type: 'math', expression: 'E=mc²' },
    {
      type: 'image',
      sourceId: Schema.decodeUnknownSync(sourceIdSchema)(17n),
      revision: 3,
      alt: 'Original figure'
    }
  ];
  const document = {
    ...blankDocument(),
    blocks: content.map((item) => createBlock(item, { type: 'page', page: 2 }))
  };
  const onChange = vi.fn();

  render(
    <StructuredEditor
      value={documentToEditor(document)}
      onChange={onChange}
      labels={labels}
      label="Document"
      placeholder="Write"
    />
  );
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
  expect(screen.getByText('Original figure')).toBeInTheDocument();
  expect(editorToDocument(documentToEditor(document), document)).toEqual(document);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Text style' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Heading' }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const edited = editorToDocument(onChange.mock.calls.at(-1)![0], document);

  expect(edited.blocks.slice(1, document.blocks.length)).toEqual(document.blocks.slice(1));
  expect(edited.blocks.at(-1)!.content).toEqual({ type: 'paragraph', inlines: [] });
  expect(edited.meta).toEqual(document.meta);
});

it('edits formatting without flattening neighboring tables and gives split blocks fresh identities', async () => {
  const document = {
    ...blankDocument(),
    blocks: [
      createBlock({ type: 'paragraph', inlines: plain('A thought') }),
      createBlock({
        type: 'table',
        rows: [{ cells: [{ header: false, paragraphs: [plain('Keep me')] }] }]
      })
    ]
  };
  const onChange = vi.fn();

  render(
    <StructuredEditor
      value={documentToEditor(document)}
      onChange={onChange}
      labels={labels}
      label="Document"
      placeholder="Write"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Text style' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Heading' }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const result = editorToDocument(onChange.mock.calls.at(-1)![0], document);

  expect(result.blocks[0]!.content).toMatchObject({ type: 'heading', level: 1 });
  expect(result.blocks[0]!.id).toBe(document.blocks[0]!.id);
  expect(result.blocks[1]).toEqual(document.blocks[1]);
  const duplicated = documentToEditor(document);

  duplicated.content!.push(structuredClone(duplicated.content![0]!));
  const split = editorToDocument(duplicated, document);

  expect(split.blocks[2]!.id).not.toBe(split.blocks[0]!.id);
});

it('keeps the caret and undo history when newly authored blocks receive database identities', async () => {
  function Controlled() {
    const [document, change] = useState(() => ({
      ...blankDocument(),
      blocks: [createBlock({ type: 'paragraph', inlines: [] })]
    }));

    return (
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={(next) => change(editorToDocument(next, document))}
        labels={labels}
        label="Document"
        placeholder="Write"
      />
    );
  }

  render(<Controlled />);
  const element = screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & {
    editor: {
      commands: {
        insertContent: (text: string) => boolean;
        splitBlock: () => boolean;
        setHeading: (options: { level: 1 }) => boolean;
        undo: () => boolean;
      };
      state: { selection: { from: number; to: number } };
    };
  };
  const editor = element.editor;

  act(() => {
    editor.commands.insertContent('First');
  });
  expect(editor.state.selection.from).toBe(6);
  act(() => {
    editor.commands.splitBlock();
  });
  expect(editor.state.selection.from).toBe(8);
  act(() => {
    editor.commands.insertContent('Second');
  });
  expect(editor.state.selection.from).toBe(14);
  expect(element.querySelectorAll('p')).toHaveLength(2);
  expect(element.textContent).toBe('FirstSecond');
  act(() => {
    editor.commands.setHeading({ level: 1 });
  });
  expect(screen.getByRole('heading', { name: 'Second' })).toBeInTheDocument();
  act(() => {
    editor.commands.undo();
  });
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Second' })).not.toBeInTheDocument()
  );
});
