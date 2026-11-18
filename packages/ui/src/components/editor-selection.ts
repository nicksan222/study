import type { Editor } from '@tiptap/core';
import { NodeSelection, Selection } from '@tiptap/pm/state';

/** Captured text ranges and selected whole nodes retain distinct restoration semantics. */
export type RichNoteSelection =
  | { kind: 'text'; anchor: number; head: number }
  | { kind: 'node'; anchor: number; head: number };

export function captureEditorSelection(editor: Editor): RichNoteSelection {
  const selection = editor.state.selection;

  return {
    kind: selection instanceof NodeSelection ? 'node' : 'text',
    anchor: selection.anchor,
    head: selection.head
  };
}

/** A stale node position must not become a replacement range in unrelated text. */
export function restoreEditorNodeSelection(
  editor: Editor,
  { anchor, head }: Extract<RichNoteSelection, { kind: 'node' }>
) {
  const { doc, tr } = editor.state;
  const node =
    Number.isInteger(anchor) && anchor >= 0 && anchor < doc.content.size
      ? doc.nodeAt(anchor)
      : null;
  const selection =
    node && NodeSelection.isSelectable(node) && anchor + node.nodeSize === head
      ? NodeSelection.create(doc, anchor)
      : Selection.atEnd(doc);

  editor.view.dispatch(tr.setSelection(selection));
  editor.view.focus();
}
