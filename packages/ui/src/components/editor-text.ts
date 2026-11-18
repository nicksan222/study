import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

export type EditorTextOptions = { continuation?: boolean; focus?: boolean };

/** Dictation enters the document as text nodes, never interpreted HTML or Markdown. */
export function insertEditorText(
  editor: Editor,
  text: string,
  { continuation = false, focus = !continuation }: EditorTextOptions = {}
) {
  if (!text) return;

  const { selection } = editor.state;

  if (selection instanceof NodeSelection && !selection.node.isTextblock) {
    const content = literalContent(text.replace(/\r\n?/g, '\n'), false);

    if (content.length) {
      const chain = editor.chain();

      if (focus) chain.focus();

      chain.insertContentAt(selection.to, { type: 'paragraph', content }).run();
    }

    return;
  }

  insertInlineText(editor, text, { continuation, focus });
}

function insertInlineText(
  editor: Editor,
  text: string,
  { continuation, focus }: Required<EditorTextOptions>
) {
  const { from: selectionStart, to } = editor.state.selection;
  const from = continuation ? to : selectionStart;
  const before = editor.state.doc.textBetween(Math.max(0, from - 1), from);
  const after = editor.state.doc.textBetween(to, Math.min(to + 1, editor.state.doc.content.size));
  const { prefix, suffix } = surroundingSpaces(before, after, text);
  const value = (prefix + text + suffix).replace(/\r\n?/g, '\n');
  const content = literalContent(value, textOnlySelection(editor));

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

function surroundingSpaces(before: string, after: string, text: string) {
  return {
    prefix: before && !/\s$/.test(before) && !/^[\s,.;:!?]/.test(text) ? ' ' : '',
    suffix: after && !/^[\s,.;:!?]/.test(after) && !/\s$/.test(text) ? ' ' : ''
  };
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
