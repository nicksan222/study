import { sourceIdSchema, createBlock } from '@study/contracts';
import type { BlockContent } from '@study/contracts';
import { test } from '@study/testing';
import { StructuredEditor } from '@study/ui';
import type { StructuredEditorInstance } from '@study/ui';
import { Schema } from 'effect';
import { useState } from 'react';

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

test.stable(
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
    const onChange = test.vi.fn();

    test.render(
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={onChange}
        labels={labels}
        label="Document"
        placeholder="Write"
      />
    );
    test.expect(test.screen.getByRole('table')).toBeInTheDocument();
    test.expect(test.screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    test.expect(test.screen.getByAltText('Original figure')).toBeInTheDocument();
    test.expect(editorToDocument(documentToEditor(document), document)).toEqual(document);
    test.expect(onChange).not.toHaveBeenCalled();
    test.fireEvent.click(test.screen.getByRole('button', { name: /^Text style: / }));
    test.fireEvent.click(await test.screen.findByRole('menuitem', { name: 'Heading' }));
    await test.waitFor(() => test.expect(onChange).toHaveBeenCalled());
    const edited = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    test.expect(edited.blocks.slice(1, document.blocks.length)).toEqual(document.blocks.slice(1));
    test.expect(edited.blocks.at(-1)!.content).toEqual({ type: 'paragraph', inlines: [] });
    test.expect(edited.meta).toEqual(document.meta);
  }
);

test.stable(
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
    const onChange = test.vi.fn();

    test.render(
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={onChange}
        labels={labels}
        label="Document"
        placeholder="Write"
      />
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: /^Text style: / }));
    test.fireEvent.click(await test.screen.findByRole('menuitem', { name: 'Heading' }));
    await test.waitFor(() => test.expect(onChange).toHaveBeenCalled());
    const result = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    test.expect(result.blocks[0]!.content).toMatchObject({ type: 'heading', level: 1 });
    test.expect(result.blocks[0]!.id).toBe(document.blocks[0]!.id);
    test.expect(result.blocks[1]).toEqual(document.blocks[1]);
    const duplicated = documentToEditor(document);

    duplicated.content!.push(structuredClone(duplicated.content![0]!));
    const split = editorToDocument(duplicated, document);

    test.expect(split.blocks[2]!.id).not.toBe(split.blocks[0]!.id);
  }
);

test.stable(
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

    test.render(<Controlled />);
    const element = test.screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & {
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

    test.act(() => {
      editor.commands.insertContent('First');
    });
    test.expect(editor.state.selection.from).toBe(6);
    test.act(() => {
      editor.commands.splitBlock();
    });
    test.expect(editor.state.selection.from).toBe(8);
    test.act(() => {
      editor.commands.insertContent('Second');
    });
    test.expect(editor.state.selection.from).toBe(14);
    test.expect(element.querySelectorAll('p')).toHaveLength(2);
    test.expect(element.textContent).toBe('FirstSecond');
    test.act(() => {
      editor.commands.setHeading({ level: 1 });
    });
    test.expect(test.screen.getByRole('heading', { name: 'Second' })).toBeInTheDocument();
    test.act(() => {
      editor.commands.undo();
    });
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('heading', { name: 'Second' })).not.toBeInTheDocument()
    );
  }
);

test.stable(
  'inserts a table through the document controls and preserves it as canonical content',
  async () => {
    const document = blankDocument();
    const onChange = test.vi.fn();

    test.render(
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={onChange}
        labels={labels}
        label="Document"
        placeholder="Write"
      />
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Insert table' }));
    const dialog = await test.screen.findByRole('dialog', { name: 'Insert table' });

    test.fireEvent.change(test.within(dialog).getByLabelText('Rows'), { target: { value: '2' } });
    test.fireEvent.change(test.within(dialog).getByLabelText('Columns'), {
      target: { value: '3' }
    });
    test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'Insert table' }));
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('table').querySelectorAll('tr')).toHaveLength(2)
    );
    const result = editorToDocument(onChange.mock.calls.at(-1)![0], document);
    const table = result.blocks.find((block) => block.content.type === 'table')!.content;

    test.expect(table).toMatchObject({
      type: 'table',
      rows: [
        { cells: [{ header: true }, { header: true }, { header: true }] },
        { cells: [{ header: false }, { header: false }, { header: false }] }
      ]
    });
  }
);

test.stable(
  'inserts an uploaded image as a durable source reference and displays the image',
  async () => {
    const document = blankDocument();
    const onChange = test.vi.fn();
    const upload = test.vi.fn().mockResolvedValue({ sourceId: '17', revision: 1, alt: 'Diagram' });

    test.render(
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

    test.fireEvent.change(test.screen.getByLabelText('Image file'), { target: { files: [file] } });
    await test.waitFor(() => test.expect(test.screen.getByAltText('Diagram')).toBeInTheDocument());
    test.fireEvent.load(test.screen.getByAltText('Diagram'));
    test.expect(test.screen.getByRole('img', { name: 'Diagram' })).toBeVisible();
    test.expect(upload).toHaveBeenCalledExactlyOnceWith(file);
    const result = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    test.expect(result.blocks.find((block) => block.content.type === 'image')?.content).toEqual({
      type: 'image',
      sourceId: sourceIdSchema.make(17n),
      revision: 1,
      alt: 'Diagram'
    });
  }
);

test.stable(
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
    const onChange = test.vi.fn();

    test.render(
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={onChange}
        labels={labels}
        label="Document"
        placeholder="Write"
      />
    );
    const editor = (
      test.screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & {
        editor: StructuredEditorInstance;
      }
    ).editor;

    test.act(() => {
      editor.chain().setCellSelection({ anchorCell: 2, headCell: 6 }).mergeCells().run();
    });
    await test.waitFor(() => test.expect(onChange).toHaveBeenCalled());
    const saved = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    test.expect(saved.blocks[0]!.id).toBe(document.blocks[0]!.id);
    test.expect(saved.blocks[0]!.content).toMatchObject({
      type: 'table',
      rows: [{ cells: [{ colspan: 2, colwidth: [140, 0] }] }, {}]
    });
    test.expect(editorToDocument(documentToEditor(saved), saved)).toEqual(saved);
  }
);

test.stable(
  'right-click formatting applies to the selected text and leaves its neighbors unchanged',
  async () => {
    const document = {
      ...blankDocument(),
      blocks: [createBlock({ type: 'paragraph', inlines: plain('Selected neighbor') })]
    };
    const onChange = test.vi.fn();

    test.render(
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={onChange}
        labels={labels}
        label="Document"
        placeholder="Write"
      />
    );
    const element = test.screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & {
      editor: StructuredEditorInstance;
    };

    test.act(() => {
      element.editor.commands.setTextSelection({ from: 1, to: 9 });
    });
    test.fireEvent.contextMenu(element);
    const menu = await test.screen.findByRole('menu', { name: 'Editing actions' });

    test.fireEvent.click(test.within(menu).getByRole('menuitem', { name: 'Bold' }));
    await test.waitFor(() => test.expect(onChange).toHaveBeenCalled());
    const saved = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    test.expect(saved.blocks[0]!.content).toEqual({
      type: 'paragraph',
      inlines: [
        { type: 'text', text: 'Selected', marks: ['strong'] },
        { type: 'text', text: ' neighbor', marks: [] }
      ]
    });
  }
);

test.stable(
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
    const onChange = test.vi.fn();

    test.render(
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={onChange}
        labels={labels}
        label="Document"
        placeholder="Write"
      />
    );
    const image = test.screen.getByAltText('Original');

    test.fireEvent.load(image);
    test.fireEvent.contextMenu(image);
    const menu = await test.screen.findByRole('menu', { name: 'Editing actions' });

    test.fireEvent.click(test.within(menu).getByRole('menuitem', { name: 'Image description' }));
    const dialog = await test.screen.findByRole('dialog', { name: 'Image description' });

    test.expect(test.within(dialog).getByLabelText('Image description')).toHaveValue('Original');

    test.fireEvent.change(test.within(dialog).getByLabelText('Image description'), {
      target: { value: 'New description' }
    });
    test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'Save description' }));
    await test.waitFor(() => test.expect(onChange).toHaveBeenCalled());
    const saved = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    test.expect(saved.blocks[0]!.content).toEqual({
      type: 'image',
      sourceId: sourceIdSchema.make(17n),
      revision: 1,
      alt: 'New description'
    });
    test.expect(saved.blocks[1]).toEqual(document.blocks[1]);
  }
);

test.stable(
  'adds a link to the selected text and retains its formatting through save and reload',
  async () => {
    const document = {
      ...blankDocument(),
      blocks: [createBlock({ type: 'paragraph', inlines: plain('Selected neighbor') })]
    };
    const onChange = test.vi.fn();

    test.render(
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={onChange}
        labels={labels}
        label="Document"
        placeholder="Write"
      />
    );
    const element = test.screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & {
      editor: StructuredEditorInstance;
    };

    test.act(() => {
      element.editor.commands.setTextSelection({ from: 1, to: 9 });
    });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Insert or edit link' }));
    const dialog = await test.screen.findByRole('dialog', { name: 'Insert or edit link' });

    test.fireEvent.change(test.within(dialog).getByLabelText('Link address'), {
      target: { value: 'https://example.com' }
    });
    test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'Save link' }));
    await test.waitFor(() => test.expect(onChange).toHaveBeenCalled());
    test.act(() => {
      element.editor.chain().setTextSelection({ from: 1, to: 9 }).toggleBold().run();
    });
    const saved = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    test.expect(saved.blocks[0]!.content).toEqual({
      type: 'paragraph',
      inlines: [
        { type: 'link', text: 'Selected', href: 'https://example.com', marks: ['strong'] },
        { type: 'text', text: ' neighbor', marks: [] }
      ]
    });
    test.expect(editorToDocument(documentToEditor(saved), saved)).toEqual(saved);
  }
);

test.stable(
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
    const onChange = test.vi.fn();

    test.render(
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={onChange}
        labels={labels}
        label="Document"
        placeholder="Write"
      />
    );
    test.fireEvent.contextMenu(test.screen.getByRole('cell', { name: 'Cell' }));
    const menu = await test.screen.findByRole('menu', { name: 'Editing actions' });

    test.fireEvent.click(test.within(menu).getByRole('menuitem', { name: 'Add row below' }));
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('table').querySelectorAll('tr')).toHaveLength(2)
    );
    const saved = editorToDocument(onChange.mock.calls.at(-1)![0], document);

    test.expect(saved.blocks[0]).toEqual(document.blocks[0]);
    test.expect(saved.blocks[1]!.id).toBe(document.blocks[1]!.id);
  }
);

test.stable('read-only rendering preserves anchors and removes editing controls', () => {
  const block = createBlock({ type: 'heading', level: 2, inlines: plain('Source heading') });
  const onChange = test.vi.fn();
  const { container } = test.render(
    <StructuredEditor
      value={documentToEditor({ ...blankDocument(), blocks: [block] })}
      onChange={onChange}
      labels={labels}
      label="Source"
      placeholder="Write"
      readOnly
    />
  );

  test
    .expect(test.screen.getByRole('heading', { name: 'Source heading' }))
    .toHaveAttribute('id', `block-${block.id}`);
  test.expect(container.querySelector('[contenteditable="false"]')).toBeInTheDocument();
  test.expect(test.screen.queryByRole('button', { name: /^Text style: / })).not.toBeInTheDocument();
  test.fireEvent.contextMenu(test.screen.getByText('Source heading'));
  test.expect(test.screen.queryByRole('menu')).not.toBeInTheDocument();
  test.expect(onChange).not.toHaveBeenCalled();
});

test.stable(
  'source previews retain list continuations, explicit numbering and reference destinations',
  () => {
    const document = {
      ...blankDocument(),
      blocks: [
        createBlock({
          type: 'list_item',
          items: [
            { depth: 0, ordered: true, start: 3, inlines: plain('Parent') },
            { depth: 1, ordered: false, start: 1, inlines: plain('Child') },
            {
              depth: 0,
              ordered: true,
              start: 3,
              continuation: true,
              inlines: plain('Continuation')
            },
            { depth: 0, ordered: true, start: 8, inlines: plain('Next') }
          ]
        }),
        createBlock({
          type: 'reference',
          href: 'https://example.com',
          inlines: plain('Reference')
        }),
        createBlock({
          type: 'image',
          sourceId: Schema.decodeUnknownSync(sourceIdSchema)(42n),
          revision: 1,
          alt: 'Diagram',
          width: 120,
          height: 80
        })
      ]
    };
    const onChange = test.vi.fn();
    const { container } = test.render(
      <StructuredEditor
        value={documentToEditor(document, { '42:1': 'data:image/png;base64,' }, true)}
        onChange={onChange}
        labels={labels}
        label="Source"
        placeholder="Write"
        readOnly
      />
    );

    test
      .expect(test.screen.getByText('Continuation').closest('li'))
      .toBe(test.screen.getByText('Parent').closest('li'));
    test.expect(test.screen.getByText('Next').closest('li')).toHaveAttribute('value', '8');
    test
      .expect(test.screen.getByRole('link', { name: 'https://example.com' }))
      .toHaveAttribute('href', 'https://example.com');
    test.expect(container.querySelector('[data-resize-handle]')).toBeNull();
    test.expect(test.screen.getByRole('img', { name: 'Diagram' })).toHaveAttribute('width', '120');
    test.expect(onChange).not.toHaveBeenCalled();
  }
);

test.stable(
  'splitting authored content keeps original anchors and continues explicit list numbering',
  () => {
    const paragraph = createBlock({ type: 'paragraph', inlines: plain('Paragraph') });
    const list = createBlock({
      type: 'list_item',
      items: [
        { depth: 0, ordered: true, start: 3, inlines: plain('Third') },
        { depth: 0, ordered: true, start: 8, inlines: plain('Eighth') }
      ]
    });
    const document = { ...blankDocument(), blocks: [paragraph, list] };
    const { container } = test.render(
      <StructuredEditor
        value={documentToEditor(document)}
        onChange={() => {}}
        labels={labels}
        label="Document"
        placeholder="Write"
      />
    );
    const editor = (
      test.screen.getByRole('textbox', { name: 'Document' }) as HTMLElement & {
        editor: StructuredEditorInstance;
      }
    ).editor;

    test.act(() => {
      editor.state.doc.descendants((node, position) => {
        if (node.text === 'Eighth') editor.commands.setTextSelection(position + node.nodeSize);
      });
      editor.commands.splitListItem('listItem');
    });
    const items = container.querySelectorAll('li');

    test.expect(items[1]).toHaveAttribute('value', '8');
    test.expect(items[2]).not.toHaveAttribute('value');
    test.expect(editorToDocument(editor.getJSON(), document).blocks[1]!.content).toMatchObject({
      items: [{ start: 3 }, { start: 8 }, { start: 9 }]
    });
    test.act(() => {
      editor.commands.setTextSelection(5);
      editor.commands.splitBlock();
    });
    test.expect(container.querySelectorAll(`[id="block-${paragraph.id}"]`)).toHaveLength(0);
    test.expect(editor.getJSON().content![0]!.attrs!.blockId).toBe(paragraph.id);
  }
);
