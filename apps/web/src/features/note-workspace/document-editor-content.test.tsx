import { sourceIdSchema } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import type { BlockContent } from '@study/contracts/sources/schemas';
import { testStable } from '@study/testing/vitest';
import { StructuredEditor } from '@study/ui/structured-editor';
import type { StructuredEditorInstance } from '@study/ui/structured-editor';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Schema } from 'effect';
import { useState } from 'react';
import { expect, vi } from 'vite-plus/test';

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
  redo: 'Redo',
  cancel: 'Cancel',
  contextMenu: 'Editing actions',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select all',
  clipboardError: 'Clipboard unavailable',
  imageDescription: 'Image description',
  deleteImage: 'Remove image',
  saveDescription: 'Save description',
  table: 'Table actions',
  insertTable: 'Insert table',
  rows: 'Rows',
  columns: 'Columns',
  headerRow: 'Header row',
  addRowBefore: 'Add row above',
  addRowAfter: 'Add row below',
  deleteRow: 'Delete row',
  addColumnBefore: 'Add column before',
  addColumnAfter: 'Add column after',
  deleteColumn: 'Delete column',
  toggleHeaderRow: 'Toggle header row',
  mergeCells: 'Merge cells',
  splitCell: 'Split cell',
  deleteTable: 'Delete table',
  image: 'Add image',
  imageFile: 'Image file',
  imageUploading: 'Adding image…',
  imageError: 'The image could not be added. Choose an image file and try again.',
  link: 'Insert or edit link',
  linkUrl: 'Link address',
  saveLink: 'Save link',
  removeLink: 'Remove link',
  invalidLink: 'Enter a valid web or email address.',
  subscript: 'Subscript',
  superscript: 'Superscript'
};

testStable(
  'retains imported rich structures, source anchors and block identity through the real editor',
  async () => {
    const content: BlockContent[] = [
      {
        type: 'heading',
        level: 3,
        inlines: [{ type: 'text', text: 'Heading', marks: ['strong'] }]
      },
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
    expect(screen.getByAltText('Original figure')).toBeInTheDocument();
    expect(editorToDocument(documentToEditor(document), document)).toEqual(document);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Text style' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Heading' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const edited = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    expect(edited.blocks.slice(1, document.blocks.length)).toEqual(document.blocks.slice(1));
    expect(edited.blocks.at(-1)!.content).toEqual({ type: 'paragraph', inlines: [] });
    expect(edited.meta).toEqual(document.meta);
  }
);

testStable(
  'edits formatting without flattening neighboring tables and gives split blocks fresh identities',
  async () => {
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
  }
);

testStable(
  'keeps the caret and undo history when newly authored blocks receive database identities',
  async () => {
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
  }
);

testStable(
  'inserts a table through the document controls and preserves it as canonical content',
  async () => {
    const document = blankDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Insert table' }));
    const dialog = await screen.findByRole('dialog', { name: 'Insert table' });

    fireEvent.change(within(dialog).getByLabelText('Rows'), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText('Columns'), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Insert table' }));
    await waitFor(() => expect(screen.getByRole('table').querySelectorAll('tr')).toHaveLength(2));
    const result = editorToDocument(onChange.mock.calls.at(-1)![0], document);
    const table = result.blocks.find((block) => block.content.type === 'table')!.content;

    expect(table).toMatchObject({
      type: 'table',
      rows: [
        { cells: [{ header: true }, { header: true }, { header: true }] },
        { cells: [{ header: false }, { header: false }, { header: false }] }
      ]
    });
  }
);

testStable(
  'inserts an uploaded image as a durable source reference and displays the image',
  async () => {
    const document = blankDocument();
    const onChange = vi.fn();
    const upload = vi.fn().mockResolvedValue({ sourceId: '17', revision: 1, alt: 'Diagram' });

    render(
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={onChange}
        labels={labels}
        label="Document"
        placeholder="Write"
        uploadImage={upload}
      />
    );
    const file = new File(['image'], 'diagram.png', { type: 'image/png' });

    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText('Diagram')).toBeInTheDocument());
    fireEvent.load(screen.getByAltText('Diagram'));
    expect(screen.getByRole('img', { name: 'Diagram' })).toBeVisible();
    expect(upload).toHaveBeenCalledExactlyOnceWith(file);
    const result = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    expect(result.blocks.find((block) => block.content.type === 'image')?.content).toEqual({
      type: 'image',
      sourceId: sourceIdSchema.make(17n),
      revision: 1,
      alt: 'Diagram'
    });
  }
);

testStable(
  'keeps merged table cells and column widths through a native Tiptap edit and canonical round trip',
  async () => {
    const document = {
      ...blankDocument(),
      blocks: [
        createBlock({
          type: 'table',
          rows: [
            {
              cells: [
                { header: false, paragraphs: [[]], colwidth: [140] },
                { header: false, paragraphs: [[]] }
              ]
            },
            {
              cells: [
                { header: false, paragraphs: [[]] },
                { header: false, paragraphs: [[]] }
              ]
            }
          ]
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
    const editor = (
      screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & {
        editor: StructuredEditorInstance;
      }
    ).editor;

    act(() => {
      editor.chain().setCellSelection({ anchorCell: 2, headCell: 6 }).mergeCells().run();
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    expect(saved.blocks[0]!.id).toBe(document.blocks[0]!.id);
    expect(saved.blocks[0]!.content).toMatchObject({
      type: 'table',
      rows: [{ cells: [{ colspan: 2, colwidth: [140, 0] }] }, {}]
    });
    expect(editorToDocument(documentToEditor(saved), saved)).toEqual(saved);
  }
);

testStable(
  'right-click formatting applies to the selected text and leaves its neighbors unchanged',
  async () => {
    const document = {
      ...blankDocument(),
      blocks: [createBlock({ type: 'paragraph', inlines: plain('Selected neighbor') })]
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
    const element = screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & {
      editor: StructuredEditorInstance;
    };

    act(() => {
      element.editor.commands.setTextSelection({ from: 1, to: 9 });
    });
    fireEvent.contextMenu(element);
    const menu = await screen.findByRole('menu', { name: 'Editing actions' });

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Bold' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    expect(saved.blocks[0]!.content).toEqual({
      type: 'paragraph',
      inlines: [
        { type: 'text', text: 'Selected', marks: ['strong'] },
        { type: 'text', text: ' neighbor', marks: [] }
      ]
    });
  }
);

testStable(
  'right-clicking an image selects it and edits its description without changing its retained identity',
  async () => {
    const document = {
      ...blankDocument(),
      blocks: [
        createBlock({
          type: 'image',
          sourceId: sourceIdSchema.make(17n),
          revision: 1,
          alt: 'Original'
        }),
        createBlock({ type: 'paragraph', inlines: plain('Neighbor') })
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
    const image = screen.getByAltText('Original');

    fireEvent.load(image);
    fireEvent.contextMenu(image);
    const menu = await screen.findByRole('menu', { name: 'Editing actions' });

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Image description' }));
    const dialog = await screen.findByRole('dialog', { name: 'Image description' });

    expect(within(dialog).getByLabelText('Image description')).toHaveValue('Original');

    fireEvent.change(within(dialog).getByLabelText('Image description'), {
      target: { value: 'New description' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save description' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    expect(saved.blocks[0]!.content).toEqual({
      type: 'image',
      sourceId: sourceIdSchema.make(17n),
      revision: 1,
      alt: 'New description'
    });
    expect(saved.blocks[1]).toEqual(document.blocks[1]);
  }
);

testStable(
  'adds a link to the selected text and retains its formatting through save and reload',
  async () => {
    const document = {
      ...blankDocument(),
      blocks: [createBlock({ type: 'paragraph', inlines: plain('Selected neighbor') })]
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
    const element = screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & {
      editor: StructuredEditorInstance;
    };

    act(() => {
      element.editor.commands.setTextSelection({ from: 1, to: 9 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Insert or edit link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Insert or edit link' });

    fireEvent.change(within(dialog).getByLabelText('Link address'), {
      target: { value: 'https://example.com' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save link' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    act(() => {
      element.editor.chain().setTextSelection({ from: 1, to: 9 }).toggleBold().run();
    });
    const saved = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    expect(saved.blocks[0]!.content).toEqual({
      type: 'paragraph',
      inlines: [
        { type: 'link', text: 'Selected', href: 'https://example.com', marks: ['strong'] },
        { type: 'text', text: ' neighbor', marks: [] }
      ]
    });
    expect(editorToDocument(documentToEditor(saved), saved)).toEqual(saved);
  }
);

testStable(
  'right-clicking a table cell offers native row actions even when the caret was outside the table',
  async () => {
    const document = {
      ...blankDocument(),
      blocks: [
        createBlock({ type: 'paragraph', inlines: plain('Intro') }),
        createBlock({
          type: 'table',
          rows: [{ cells: [{ header: false, paragraphs: [plain('Cell')] }] }]
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
    fireEvent.contextMenu(screen.getByRole('cell', { name: 'Cell' }));
    const menu = await screen.findByRole('menu', { name: 'Editing actions' });

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add row below' }));
    await waitFor(() => expect(screen.getByRole('table').querySelectorAll('tr')).toHaveLength(2));
    const saved = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    expect(saved.blocks[0]).toEqual(document.blocks[0]);
    expect(saved.blocks[1]!.id).toBe(document.blocks[1]!.id);
  }
);
