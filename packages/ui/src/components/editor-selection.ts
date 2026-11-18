import type { Editor } from '@tiptap/core';
import { NodeSelection, Selection } from '@tiptap/pm/state';

/** Captured text ranges and selected whole nodes retain distinct restoration semantics. */
export type RichNoteSelection =
  | { kind: 'text'; anchor: number; head: number }
  | { kind: 'node'; anchor: number; head: number; nodeType: string; blockId?: string };

export function captureEditorSelection(editor: Editor): RichNoteSelection {
  const selection = editor.state.selection;

  const { anchor, head } = selection;

  if (!(selection instanceof NodeSelection)) return { kind: 'text', anchor, head };

  const { type, attrs } = selection.node;

  return { kind: 'node', anchor, head, nodeType: type.name, blockId: blockIdentity(attrs) };
}

/** A stale node position must not become a replacement range in unrelated text. */
export function restoreEditorNodeSelection(
  editor: Editor,
  { anchor, head, nodeType, blockId }: Extract<RichNoteSelection, { kind: 'node' }>,
  focus: boolean
) {
  const { doc, tr } = editor.state;
  const node =
    Number.isInteger(anchor) && anchor >= 0 && anchor < doc.content.size
      ? doc.nodeAt(anchor)
      : null;
  const selection =
    node &&
    node.type.name === nodeType &&
    blockIdentity(node.attrs) === blockId &&
    NodeSelection.isSelectable(node) &&
    anchor + node.nodeSize === head
      ? NodeSelection.create(doc, anchor)
      : Selection.atEnd(doc);

  editor.view.dispatch(tr.setSelection(selection));

  if (focus) editor.view.focus();
}

function blockIdentity(attrs: Readonly<Record<string, unknown>>) {
  return typeof attrs.blockId === 'string' ? attrs.blockId : undefined;
}
