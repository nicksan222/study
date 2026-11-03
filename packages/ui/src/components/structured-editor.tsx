import { Extension, Mark, Node } from '@tiptap/core';
import type { Editor, JSONContent } from '@tiptap/core';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { RichNoteEditorSurface } from './rich-note';
import type { RichNoteLabels } from './rich-note';

export type StructuredEditorValue = JSONContent;

const identity = Extension.create({
  name: 'documentIdentity',
  addGlobalAttributes: () => [
    {
      types: ['paragraph', 'heading', 'codeBlock', 'bulletList', 'orderedList', 'listItem'],
      attributes: {
        blockId: { default: null, rendered: false },
        sourceKind: { default: null, rendered: false },
        sourceHref: { default: null, rendered: false },
        continuation: { default: false, rendered: false },
        itemStart: { default: null, rendered: false }
      }
    }
  ]
});

const retainedList = Node.create({
  name: 'documentList',
  group: 'block',
  content: '(bulletList | orderedList)*',
  addAttributes: () => ({ blockId: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: 'div[data-document-list]' }],
  renderHTML: () => ['div', { 'data-document-list': '' }, 0]
});

const table = Node.create({
  name: 'documentTable',
  group: 'block',
  content: 'documentRow*',
  isolating: true,
  addAttributes: () => ({ blockId: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: 'table' }],
  renderHTML: () => ['table', ['tbody', 0]]
});

const row = Node.create({
  name: 'documentRow',
  content: 'documentCell*',
  parseHTML: () => [{ tag: 'tr' }],
  renderHTML: () => ['tr', 0]
});

const cell = Node.create({
  name: 'documentCell',
  content: 'paragraph*',
  isolating: true,
  addAttributes: () => ({ header: { default: false, rendered: false } }),
  parseHTML: () => [{ tag: 'td' }, { tag: 'th', attrs: { header: true } }],
  renderHTML: ({ node }) => [node.attrs.header ? 'th' : 'td', 0]
});

const math = Node.create({
  name: 'documentMath',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  addAttributes: () => ({ blockId: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: 'pre[data-document-math]' }],
  renderHTML: () => ['pre', { 'data-document-math': '' }, 0]
});

const inlineMath = Node.create({
  name: 'documentInlineMath',
  group: 'inline',
  inline: true,
  content: 'text*',
  marks: '',
  parseHTML: () => [{ tag: 'span[data-document-math]' }],
  renderHTML: () => ['span', { 'data-document-math': '' }, 0]
});

const image = Node.create({
  name: 'documentImage',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    blockId: { default: null, rendered: false },
    sourceId: { default: null, rendered: false },
    revision: { default: null, rendered: false },
    alt: { default: '', rendered: false }
  }),
  parseHTML: () => [],
  renderHTML: ({ node }) => [
    'figure',
    { 'data-document-image': '', 'aria-label': node.attrs.alt },
    ['figcaption', node.attrs.alt]
  ]
});

const subscript = Mark.create({
  name: 'subscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: () => ['sub', 0]
});

const superscript = Mark.create({
  name: 'superscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: () => ['sup', 0]
});

const structuredEditorExtensions = [
  StarterKit.configure({
    blockquote: false,
    underline: false,
    horizontalRule: false,
    link: { openOnClick: false }
  }),
  identity,
  retainedList,
  table,
  row,
  cell,
  math,
  inlineMath,
  image,
  subscript,
  superscript
];

/** A structured editor leaves serialization and durable document ownership to its caller. */
export function StructuredEditor({
  value,
  onChange,
  label,
  placeholder,
  labels,
  toolbarEnd,
  disabled = false
}: {
  value: StructuredEditorValue;
  onChange: (value: StructuredEditorValue) => void;
  label: string;
  placeholder: string;
  labels: RichNoteLabels;
  toolbarEnd?: ReactNode;
  disabled?: boolean;
}) {
  const editor = useEditor({
    extensions: structuredEditorExtensions,
    content: value,
    editable: !disabled,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true',
        'data-placeholder': placeholder
      }
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.getJSON());
    }
  });

  useEffect(() => {
    const normalized = editor.schema.nodeFromJSON(value).toJSON();

    if (JSON.stringify(editor.getJSON()) === JSON.stringify(normalized)) return;

    if (synchronizeBlockIdentities(editor, normalized)) return;

    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  return (
    <RichNoteEditorSurface
      editor={editor}
      labels={labels}
      disabled={disabled}
      toolbarEnd={toolbarEnd}
      structured
    />
  );
}

/** Persisted block IDs are metadata: confirming them must not move the caret or reset undo. */
function synchronizeBlockIdentities(editor: Editor, value: JSONContent): boolean {
  const withoutIdentity = (key: string, entry: unknown) => (key === 'blockId' ? undefined : entry);

  if (JSON.stringify(editor.getJSON(), withoutIdentity) !== JSON.stringify(value, withoutIdentity))
    return false;

  const document = editor.schema.nodeFromJSON(value);
  const transaction = editor.state.tr;

  document.descendants((node, position) => {
    if (!('blockId' in node.attrs)) return;

    const current = transaction.doc.nodeAt(position);

    if (current?.attrs.blockId !== node.attrs.blockId)
      transaction.setNodeMarkup(position, undefined, {
        ...current?.attrs,
        blockId: node.attrs.blockId
      });
  });

  if (transaction.docChanged)
    editor.view.dispatch(transaction.setMeta('preventUpdate', true).setMeta('addToHistory', false));

  return true;
}
