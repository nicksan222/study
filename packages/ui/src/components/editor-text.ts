import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

/** Dictation enters the document as text nodes, never interpreted HTML or Markdown. */
export function insertEditorText(editor: Editor, text: string) {
  const { selection } = editor.state;

  if (selection instanceof NodeSelection && !selection.node.isTextblock) {
    const content = literalContent(text.replace(/\r\n?/g, '\n'), false);

    if (content.length)
      editor.chain().focus().insertContentAt(selection.to, { type: 'paragraph', content }).run();

    return;
  }

  insertInlineText(editor, text);
}

function insertInlineText(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  const before = editor.state.doc.textBetween(Math.max(0, from - 1), from);
  const after = editor.state.doc.textBetween(to, Math.min(to + 1, editor.state.doc.content.size));
  const prefix = before && !/\s$/.test(before) && text && !/^[\s,.;:!?]/.test(text) ? ' ' : '';
  const suffix = after && !/^[\s,.;:!?]/.test(after) && text && !/\s$/.test(text) ? ' ' : '';
  const value = (prefix + text + suffix).replace(/\r\n?/g, '\n');
  const content = literalContent(value, editor.isActive('codeBlock'));

  if (content.length) editor.chain().focus().insertContent(content).run();
}

function literalContent(value: string, codeBlock: boolean) {
  if (codeBlock) return value ? [{ type: 'text', text: value }] : [];

  return value
    .split('\n')
    .flatMap((line, index) => [
      ...(index ? [{ type: 'hardBreak' }] : []),
      ...(line ? [{ type: 'text', text: line }] : [])
    ]);
}
