import { generateText } from '@tiptap/core';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
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
import {
  cloneElement,
  isValidElement,
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef
} from 'react';
import type { ReactElement, ReactNode } from 'react';

import { Button } from './button';
import { Menu, MenuTrigger, MenuPopup, MenuItem } from './menu';
import { blockNoteMath, inlineNoteMath, NoteMath } from './note-math';

const extensions = [StarterKit.configure({ link: { openOnClick: false } })];

const readingExtensions = [...extensions, inlineNoteMath, blockNoteMath];

const markdown = new MarkdownManager({ extensions, markedOptions: { breaks: true } });

const readingMarkdown = new MarkdownManager({
  extensions: readingExtensions,
  markedOptions: { breaks: true }
});

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
  readOnly = false,
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
  readOnly?: boolean;
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
    <div className="rich-note-editor" data-disabled={(disabled && !readOnly) || undefined}>
      {!readOnly && (
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
      )}
      {notice}
      {children ?? <EditorContent editor={editor} className="rich-note-content" />}
    </div>
  );
}

const ReadingContext = createContext<{
  renderText?: (value: string) => ReactNode;
  streaming: boolean;
}>({ streaming: false });

type ReadingNodeProps = {
  node: ProseMirrorNode;
  parent?: ProseMirrorNode;
  children?: ReactNode;
};

// Stable renderer identities keep already visible words mounted between stream updates.
const readingNodeMapping = {
  doc: ({ children }: ReadingNodeProps) => <>{children}</>,
  paragraph: ({ children }: ReadingNodeProps) => <p>{children}</p>,
  heading: ({ node, children }: ReadingNodeProps) => {
    const Tag = `h${node.attrs.level}` as 'h1';

    return <Tag>{children}</Tag>;
  },
  bulletList: ({ children }: ReadingNodeProps) => <ul>{children}</ul>,
  orderedList: ({ node, children }: ReadingNodeProps) => (
    <ol start={node.attrs.start}>{children}</ol>
  ),
  listItem: ({ children }: ReadingNodeProps) => <li>{children}</li>,
  blockquote: ({ children }: ReadingNodeProps) => <blockquote>{children}</blockquote>,
  inlineNoteMath: ({ node }: ReadingNodeProps) => <NoteMath latex={node.attrs.latex} />,
  blockNoteMath: ({ node }: ReadingNodeProps) => <NoteMath latex={node.attrs.latex} display />,
  text: function ReadingText({ node, parent }: ReadingNodeProps) {
    const { renderText, streaming } = useContext(ReadingContext);
    const text = node.text ?? '';

    if (
      parent?.type.name === 'codeBlock' ||
      node.marks.some((mark) => mark.type.name === 'code' || mark.type.name === 'link')
    )
      return text;

    if (renderText) return renderText(text);

    return streaming
      ? Array.from(text.matchAll(/\S+\s*|\s+/g), (match) => (
          <span key={match.index} data-stream-word="">
            {match[0]}
          </span>
        ))
      : text;
  }
};

const readingMarkMapping = {
  bold: ({ children }: { children?: ReactNode }) => <strong>{children}</strong>,
  italic: ({ children }: { children?: ReactNode }) => <em>{children}</em>,
  strike: ({ children }: { children?: ReactNode }) => <s>{children}</s>,
  underline: ({ children }: { children?: ReactNode }) => <u>{children}</u>
};

/** Tiptap assigns traversal keys that shift on append; reading uses sibling positions. */
function stableReadingKeys(content: ReactNode): ReactNode {
  if (Array.isArray(content)) return content.map(stableReadingKeys);

  if (!isValidElement(content)) return content;

  const element = content as ReactElement<{ children?: ReactNode }>;
  const children = element.props.children;

  return cloneElement(
    element,
    { key: null },
    ...(Array.isArray(children) ? children : [children]).map((child, index) => {
      const stable = stableReadingKeys(child);

      return isValidElement(stable) ? cloneElement(stable, { key: index }) : stable;
    })
  );
}

/** Renders saved notes and live previews through the same math-aware Markdown parser. */
export function RichNoteContent({
  value,
  renderText,
  streaming = false
}: {
  value: string;
  renderText?: (value: string) => ReactNode;
  streaming?: boolean;
}) {
  const context = useMemo(() => ({ renderText, streaming }), [renderText, streaming]);
  const content = useMemo(
    () =>
      stableReadingKeys(
        renderToReactElement({
          extensions: readingExtensions,
          content: readingMarkdown.parse(value),
          options: { nodeMapping: readingNodeMapping, markMapping: readingMarkMapping }
        })
      ),
    [value]
  );

  return (
    <ReadingContext value={context}>
      <div className="rich-note-content">{content}</div>
    </ReadingContext>
  );
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
