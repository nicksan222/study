import type { Editor } from '@tiptap/core';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';

/** Captured text ranges and selected whole nodes retain distinct restoration semantics. */
export type RichNoteSelection =
  | { kind: 'text'; anchor: number; head: number }
  | { kind: 'node'; anchor: number; head: number; nodeType: string; blockId?: string };

export function readNativeTextSelection(view: EditorView) {
  const { dom } = view;
  const selection = dom.ownerDocument.getSelection();

  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !dom.contains(selection.anchorNode) ||
    !dom.contains(selection.focusNode)
  )
    return undefined;

  return {
    anchor: view.posAtDOM(selection.anchorNode, selection.anchorOffset),
    head: view.posAtDOM(selection.focusNode, selection.focusOffset)
  };
}

/** Native navigation can move the caret before ProseMirror observes the selection change. */
export function reconcileEnterSelection(view: EditorView, event: KeyboardEvent): boolean {
  if (
    event.key !== 'Enter' ||
    event.isComposing ||
    view.composing ||
    !(view.state.selection instanceof TextSelection)
  )
    return false;

  const native = readNativeTextSelection(view);

  if (!native) return false;

  const { doc, tr, selection } = view.state;
  const next = TextSelection.between(doc.resolve(native.anchor), doc.resolve(native.head));

  if (!next.eq(selection)) view.dispatch(tr.setSelection(next));

  return false;
}

export function captureEditorSelection(editor: Editor): RichNoteSelection {
  const selection = editor.state.selection;

  if (selection instanceof CellSelection) {
    const caret = tableSelectionCaret(selection);

    return { kind: 'text', anchor: caret, head: caret };
  }

  const { anchor, head } = selection;

  if (!(selection instanceof NodeSelection)) return { kind: 'text', anchor, head };

  const { type, attrs } = selection.node;

  return { kind: 'node', anchor, head, nodeType: type.name, blockId: blockIdentity(attrs) };
}

/** The primary range of a cell selection covers the head cell's paragraphs. */
export function tableSelectionCaret(selection: CellSelection) {
  return Selection.near(selection.$to, -1).head;
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

  // Tiptap may append an empty editing paragraph during this selection transaction.
  editor.view.dispatch(
    tr.setSelection(selection).setMeta('preventUpdate', true).setMeta('addToHistory', false)
  );

  if (focus) editor.view.focus();
}

function blockIdentity(attrs: Readonly<Record<string, unknown>>) {
  return typeof attrs.blockId === 'string' ? attrs.blockId : undefined;
}
