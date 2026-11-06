import { generateText } from '@tiptap/core';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { renderToReactElement } from '@tiptap/static-renderer/pm/react';
import {
  Bold,
  Underline,
  Strikethrough,
  ChevronDown,
  RemoveFormatting,
  Italic,
  List,
  ListOrdered,
  Quote,
  Code2,
  Undo2,
  Redo2
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

import { Button } from './button';
import { Menu, MenuTrigger, MenuPopup, MenuItem } from './menu';

const extensions = [StarterKit.configure({ link: { openOnClick: false } })];

const markdown = new MarkdownManager({ extensions, markedOptions: { breaks: true } });

/** Uses the same Markdown parser to label a note without formatting syntax. */
export function RichNoteSummary({ value, fallback }: { value: string; fallback?: ReactNode }) {
  const text = useMemo(() => {
    const first = markdown.parse(value).content?.[0];

    return first
      ? generateText({ type: 'doc', content: [first] }, extensions)
          .trim()
          .split('\n')[0]
      : '';
  }, [value]);

  return text || fallback;
}

export type RichNoteLabels = Record<
  | 'formatting'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'paragraph'
  | 'textStyle'
  | 'clear'
  | 'heading'
  | 'subheading'
  | 'bullets'
  | 'numbered'
  | 'quote'
  | 'code'
  | 'undo'
  | 'redo',
  string
>;

/** Edits Markdown through Tiptap while keeping the caller's versioned text as the only persisted value. */
export function RichNoteEditor({
  value,
  onChange,
  label,
  placeholder,
  labels,
  toolbarEnd,
  disabled = false,
  spellcheck = true,
  fontSize = 16
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  labels: RichNoteLabels;
  toolbarEnd?: ReactNode;
  disabled?: boolean;
  spellcheck?: boolean;
  fontSize?: number;
}) {
  const latest = useRef(value);
  const editor = useEditor({
    extensions: [...extensions, Markdown.configure({ markedOptions: { breaks: true } })],
    content: value,
    contentType: 'markdown',
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
      latest.current = current.isEmpty ? '' : current.getMarkdown();
      onChange(latest.current);
    }
  });

  useEffect(() => {
    if (latest.current === value) return;

    latest.current = value;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  return (
    <RichNoteEditorSurface
      editor={editor}
      labels={labels}
      disabled={disabled}
      toolbarEnd={toolbarEnd}
      spellcheck={spellcheck}
      fontSize={fontSize}
    />
  );
}

export function RichNoteEditorSurface({
  editor,
  labels,
  disabled,
  toolbarEnd,
  structured = false,
  controls,
  notice,
  children,
  spellcheck = true,
  fontSize = 16
}: {
  editor: Editor;
  labels: RichNoteLabels;
  disabled: boolean;
  toolbarEnd?: ReactNode;
  structured?: boolean;
  controls?: ReactNode;
  notice?: ReactNode;
  children?: ReactNode;
  spellcheck?: boolean;
  fontSize?: number;
}) {
  useEffect(() => {
    editor.setEditable(!disabled, false);
    const attributes = editor.options.editorProps.attributes;
    const preferences = { spellcheck: String(spellcheck), style: `font-size: ${fontSize}px` };

    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes:
          typeof attributes === 'function'
            ? (state) => ({ ...attributes(state), ...preferences })
            : { ...attributes, ...preferences }
      }
    });
  }, [disabled, editor, spellcheck, fontSize]);

  return (
    <div className="rich-note-editor" data-disabled={disabled || undefined}>
      <div className="rich-note-ribbon">
        <RichNoteFormatting
          editor={editor}
          labels={labels}
          disabled={disabled}
          structured={structured}
          controls={controls}
        />
        {toolbarEnd && <div className="rich-note-toolbar-end">{toolbarEnd}</div>}
      </div>
      {notice}
      {children ?? <EditorContent editor={editor} className="rich-note-content" />}
    </div>
  );
}

/** Renders saved notes without creating an editor instance for every history entry. */
export function RichNoteContent({
  value,
  renderText
}: {
  value: string;
  renderText?: (value: string) => ReactNode;
}) {
  const content = useMemo(
    () =>
      renderToReactElement({
        extensions,
        content: markdown.parse(value),
        options: renderText
          ? {
              nodeMapping: {
                text: ({ node, parent }) =>
                  parent?.type.name === 'codeBlock' ||
                  node.marks.some((mark) => mark.type.name === 'code' || mark.type.name === 'link')
                    ? node.text
                    : renderText(node.text ?? '')
              }
            }
          : undefined
      }),
    [value, renderText]
  );

  return <div className="rich-note-content">{content}</div>;
}

function RichNoteFormatting({
  editor,
  labels,
  disabled,
  structured = false,
  controls
}: {
  editor: Editor;
  labels: RichNoteLabels;
  disabled: boolean;
  structured?: boolean;
  controls?: ReactNode;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      italic: current.isActive('italic'),
      heading: current.isActive('heading', { level: 1 }),
      subheading: current.isActive('heading', { level: 2 }),
      bullets: current.isActive('bulletList'),
      numbered: current.isActive('orderedList'),
      quote: current.isActive('blockquote'),
      code: current.isActive('codeBlock'),
      undo: current.can().undo(),
      redo: current.can().redo()
    })
  });
  const actions = [
    { id: 'bold', Icon: Bold, run: () => editor.chain().focus().toggleBold().run() },
    { id: 'italic', Icon: Italic, run: () => editor.chain().focus().toggleItalic().run() },
    { id: 'underline', Icon: Underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { id: 'strike', Icon: Strikethrough, run: () => editor.chain().focus().toggleStrike().run() },
    { id: 'bullets', Icon: List, run: () => editor.chain().focus().toggleBulletList().run() },
    {
      id: 'numbered',
      Icon: ListOrdered,
      run: () => editor.chain().focus().toggleOrderedList().run()
    },
    { id: 'quote', Icon: Quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { id: 'code', Icon: Code2, run: () => editor.chain().focus().toggleCodeBlock().run() }
  ] as const;

  return (
    <div className="rich-note-toolbar" role="group" aria-label={labels.formatting}>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost-muted"
              size="sm"
              disabled={disabled}
              aria-label={labels.textStyle}
            />
          }
        >
          {labels[state.heading ? 'heading' : state.subheading ? 'subheading' : 'paragraph']}
          <ChevronDown size={14} aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuItem onClick={() => editor.chain().focus().setParagraph().run()}>
            {labels.paragraph}
          </MenuItem>
          <MenuItem onClick={() => editor.chain().focus().setHeading({ level: 1 }).run()}>
            {labels.heading}
          </MenuItem>
          <MenuItem onClick={() => editor.chain().focus().setHeading({ level: 2 }).run()}>
            {labels.subheading}
          </MenuItem>
        </MenuPopup>
      </Menu>
      <span className="rich-note-toolbar-divider" aria-hidden="true" />
      {actions
        .filter(({ id }) => !structured || (id !== 'underline' && id !== 'quote'))
        .map(({ id, Icon, run }) => (
          <Fragment key={id}>
            {id === 'bullets' && <span className="rich-note-toolbar-divider" aria-hidden="true" />}
            <Button
              size="icon-sm"
              variant="ghost-muted"
              aria-label={labels[id]}
              title={labels[id]}
              aria-pressed={state[id]}
              disabled={disabled}
              onClick={run}
            >
              <Icon size={16} aria-hidden="true" />
            </Button>
          </Fragment>
        ))}
      <Button
        size="icon-sm"
        variant="ghost-muted"
        aria-label={labels.clear}
        title={labels.clear}
        disabled={disabled}
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting size={16} aria-hidden="true" />
      </Button>
      {controls}
      <span className="rich-note-toolbar-divider" aria-hidden="true" />
      <Button
        size="icon-sm"
        variant="ghost-muted"
        aria-label={labels.undo}
        title={labels.undo}
        disabled={disabled || !state.undo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 size={16} aria-hidden="true" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost-muted"
        aria-label={labels.redo}
        title={labels.redo}
        disabled={disabled || !state.redo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}
