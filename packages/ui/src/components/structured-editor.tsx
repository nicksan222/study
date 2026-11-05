import { Extension, Node } from '@tiptap/core';
import type { Editor, JSONContent } from '@tiptap/core';
import FileHandler from '@tiptap/extension-file-handler';
import Image from '@tiptap/extension-image';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TableKit, TableCell, TableHeader } from '@tiptap/extension-table';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import { RichNoteEditorSurface } from './rich-note';
import { StructuredEditorContextMenu } from './structured-editor-context-menu';
import { StructuredEditorControls } from './structured-editor-controls';
import { StructuredImageDescription } from './structured-editor-image-description';
import { useEditorImageInsertion } from './structured-editor-images';
import { StructuredLinkDialog } from './structured-editor-link';
import { StructuredTableDialog } from './structured-editor-table';
import type { EditorImageReference, StructuredEditorLabels } from './structured-editor-types';

export type { Editor as StructuredEditorInstance } from '@tiptap/core';
export type { EditorImageReference, StructuredEditorLabels } from './structured-editor-types';

export type StructuredEditorValue = JSONContent;

const identity = Extension.create({
  name: 'documentIdentity',
  addGlobalAttributes: () => [
    {
      types: [
        'paragraph',
        'heading',
        'codeBlock',
        'bulletList',
        'orderedList',
        'listItem',
        'table',
        'image'
      ],
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

const image = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      sourceId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-source-id'),
        renderHTML: (attributes) => ({ 'data-source-id': attributes.sourceId })
      },
      revision: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-revision')),
        renderHTML: (attributes) => ({ 'data-revision': attributes.revision })
      }
    };
  },
  parseHTML: () => [{ tag: 'img[data-source-id][data-revision]' }],
  addInputRules: () => []
}).configure({
  resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 48, minHeight: 48 }
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
  TableKit.configure({
    table: { resizable: true, allowTableNodeSelection: true },
    tableCell: false,
    tableHeader: false
  }),
  TableCell.extend({ content: 'paragraph+' }),
  TableHeader.extend({ content: 'paragraph+' }),
  math,
  inlineMath,
  image,
  Subscript,
  Superscript
];

/** A structured editor leaves serialization and durable document ownership to its caller. */
export function StructuredEditor({
  value,
  onChange,
  label,
  placeholder,
  labels,
  toolbarEnd,
  uploadImage,
  disabled = false,
  spellcheck = true,
  fontSize = 16
}: {
  value: StructuredEditorValue;
  onChange: (value: StructuredEditorValue) => void;
  label: string;
  placeholder: string;
  labels: StructuredEditorLabels;
  toolbarEnd?: ReactNode;
  uploadImage?: (file: File) => Promise<EditorImageReference>;
  disabled?: boolean;
  spellcheck?: boolean;
  fontSize?: number;
}) {
  const images = useEditorImageInsertion(uploadImage);
  const file = useRef<HTMLInputElement>(null);
  const extensions = useMemo(
    () => editorExtensions(Boolean(uploadImage), images.insert),
    [images.insert, uploadImage]
  );
  const editor = useEditor({
    extensions,
    content: value,
    editable: !disabled,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true',
        'data-placeholder': placeholder,
        spellcheck: String(spellcheck),
        style: `font-size: ${fontSize}px`
      }
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.getJSON());
    }
  });

  useEditorValue(editor, value);

  const dialogs = useEditorDialog(editor);

  const chooseImage = uploadImage ? () => file.current?.click() : undefined;
  const upload = uploadImage
    ? (files: File[]) => {
        void images.insert(editor, files);
      }
    : undefined;

  return (
    <>
      <RichNoteEditorSurface
        editor={editor}
        labels={labels}
        disabled={disabled}
        toolbarEnd={toolbarEnd}
        spellcheck={spellcheck}
        fontSize={fontSize}
        structured
        controls={
          <StructuredEditorControls
            editor={editor}
            labels={labels}
            disabled={disabled}
            uploading={images.pending}
            onInsertImage={chooseImage}
            onInsertTable={dialogs.openTable}
            onEditLink={dialogs.openLink}
          />
        }
        notice={
          <ImageInsertionNotice pending={images.pending} failed={images.failed} labels={labels} />
        }
      >
        <StructuredEditorContextMenu
          editor={editor}
          labels={labels}
          disabled={disabled}
          onInsertTable={dialogs.openTable}
          onEditLink={dialogs.openLink}
          onInsertImage={chooseImage}
          onEditImage={dialogs.openImage}
          upload={upload}
        >
          <EditorContent editor={editor} className="rich-note-content" />
        </StructuredEditorContextMenu>
      </RichNoteEditorSurface>
      <ImageFileInput
        inputRef={file}
        label={labels.imageFile}
        disabled={disabled || images.pending}
        upload={upload}
      />
      <StructuredEditorDialogs
        editor={editor}
        labels={labels}
        dialog={dialogs.dialog}
        onOpenChange={dialogs.close}
      />
    </>
  );
}

function useEditorValue(editor: Editor, value: StructuredEditorValue) {
  useEffect(() => {
    const normalized = editor.schema.nodeFromJSON(value).toJSON();

    if (JSON.stringify(editor.getJSON()) === JSON.stringify(normalized)) return;

    if (synchronizeBlockIdentities(editor, normalized)) return;

    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
}

/** Persisted block IDs are metadata: confirming them must not move the caret or reset undo. */
function synchronizeBlockIdentities(editor: Editor, value: JSONContent): boolean {
  const withoutIdentity = (key: string, entry: unknown) =>
    key === 'blockId' || key === 'src' ? undefined : entry;

  if (JSON.stringify(editor.getJSON(), withoutIdentity) !== JSON.stringify(value, withoutIdentity))
    return false;

  const document = editor.schema.nodeFromJSON(value);
  const transaction = editor.state.tr;

  document.descendants((node, position) => {
    if (!('blockId' in node.attrs)) return;

    const current = transaction.doc.nodeAt(position);

    if (current?.attrs.blockId !== node.attrs.blockId || current?.attrs.src !== node.attrs.src)
      transaction.setNodeMarkup(position, undefined, {
        ...current?.attrs,
        blockId: node.attrs.blockId,
        ...('src' in node.attrs ? { src: node.attrs.src } : {})
      });
  });

  if (transaction.docChanged)
    editor.view.dispatch(transaction.setMeta('preventUpdate', true).setMeta('addToHistory', false));

  return true;
}

function ImageInsertionNotice({
  pending,
  failed,
  labels
}: {
  pending: boolean;
  failed: boolean;
  labels: StructuredEditorLabels;
}) {
  if (failed)
    return (
      <p className="structured-editor-notice" role="alert">
        {labels.imageError}
      </p>
    );

  if (pending)
    return (
      <p className="structured-editor-notice" role="status">
        {labels.imageUploading}
      </p>
    );

  return null;
}

function ImageFileInput({
  inputRef,
  label,
  disabled,
  upload
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  disabled: boolean;
  upload?: (files: File[]) => void;
}) {
  if (!upload) return null;

  return (
    <input
      className="sr-only"
      ref={inputRef}
      type="file"
      accept="image/*"
      multiple
      aria-label={label}
      disabled={disabled}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);

        event.target.value = '';
        upload(files);
      }}
    />
  );
}

function editorExtensions(
  upload: boolean,
  insert: ReturnType<typeof useEditorImageInsertion>['insert']
) {
  if (!upload) return structuredEditorExtensions;

  return [
    ...structuredEditorExtensions,
    FileHandler.configure({
      consumePasteEvent: true,
      onDrop: (editor, files, position) => {
        void insert(editor, files, position);
      },
      onPaste: (editor, files) => {
        void insert(editor, files);
      }
    })
  ];
}

function StructuredEditorDialogs({
  editor,
  labels,
  dialog,
  onOpenChange
}: {
  editor: Editor;
  labels: StructuredEditorLabels;
  dialog: EditorDialog | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <StructuredTableDialog
        editor={editor}
        labels={labels}
        open={dialog?.type === 'table'}
        onOpenChange={onOpenChange}
      />
      {dialog?.type === 'link' && (
        <StructuredLinkDialog editor={editor} labels={labels} open onOpenChange={onOpenChange} />
      )}
      {dialog?.type === 'image' && (
        <StructuredImageDescription
          editor={editor}
          position={dialog.position}
          labels={labels}
          open
          onOpenChange={onOpenChange}
        />
      )}
    </>
  );
}

type EditorDialog = { type: 'table' | 'link' } | { type: 'image'; position: number };

function useEditorDialog(editor: Editor) {
  const [dialog, setDialog] = useState<EditorDialog>();

  return {
    dialog,
    openTable: () => setDialog({ type: 'table' }),
    openLink: () => setDialog({ type: 'link' }),
    openImage: () => setDialog({ type: 'image', position: editor.state.selection.from }),
    close: (open: boolean) => {
      if (!open) setDialog(undefined);
    }
  };
}
