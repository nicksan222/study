import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

import { dictationSpacing } from './editor-text-spacing';

export type EditorTextOptions = { append?: boolean; continuation?: boolean; focus?: boolean };

/** Dictation enters the document as text nodes, never interpreted HTML or Markdown. */
export function insertEditorText(
  editor: Editor,
  text: string,
  { append = false, continuation = false, focus = !continuation }: EditorTextOptions = {}
) {
  if (!text) return;

  const { doc, selection } = editor.state;

  if (append) {
    if (doc.lastChild?.type.name === 'paragraph') {
      const end = doc.content.size - 1;

      insertInlineText(editor, text, end, end, false, focus);
    } else {
      insertParagraph(editor, text, doc.content.size, focus);
    }

    return;
  }

  if (selection instanceof NodeSelection && !selection.node.isTextblock) {
    insertParagraph(editor, text, selection.to, focus);

    return;
  }

  const { from, to } = selection;

  insertInlineText(editor, text, continuation ? to : from, to, textOnlySelection(editor), focus);
}

function insertParagraph(editor: Editor, text: string, position: number, focus: boolean) {
  const content = literalContent(text.replace(/\r\n?/g, '\n'), false);

  if (!content.length) return;

  const chain = editor.chain();

  if (focus) chain.focus();

  chain.insertContentAt(position, { type: 'paragraph', content }).run();
}

function insertInlineText(
  editor: Editor,
  text: string,
  from: number,
  to: number,
  textOnly: boolean,
  focus: boolean
) {
  const { doc } = editor.state;
  const before = doc.textBetween(Math.max(0, from - 1), from);
  const after = doc.textBetween(to, Math.min(to + 1, doc.content.size));
  const { prefix, suffix } = dictationSpacing(before, text, after);
  const value = (prefix + text + suffix).replace(/\r\n?/g, '\n');
  const content = literalContent(value, textOnly);

  if (content.length) {
    const chain = editor.chain();

    if (focus) chain.focus();

    chain.insertContentAt({ from, to }, content);

    // A later segment can start with punctuation before the separator we just added.
    if (suffix)
      chain.command(({ tr }) => {
        tr.setSelection(TextSelection.create(tr.doc, tr.selection.from - suffix.length));

        return true;
      });

    chain.run();
  }
}

function textOnlySelection(editor: Editor) {
  const { selection, schema } = editor.state;
  const node = selection instanceof NodeSelection ? selection.node : selection.$from.parent;
  const hardBreak = schema.nodes.hardBreak;

  return !hardBreak || !node.type.contentMatch.matchType(hardBreak);
}

function literalContent(value: string, textOnly: boolean) {
  if (textOnly) return value ? [{ type: 'text', text: value }] : [];

  return value
    .split('\n')
    .flatMap((line, index) => [
      ...(index ? [{ type: 'hardBreak' }] : []),
      ...(line ? [{ type: 'text', text: line }] : [])
    ]);
}
