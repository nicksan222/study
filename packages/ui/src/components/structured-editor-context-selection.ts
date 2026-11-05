import type { Editor } from '@tiptap/core';

/** Keeps an existing table range, or moves the caret to the cell that was right-clicked. */
export function selectContextTarget(editor: Editor, target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  const image = target.closest('img');
  if (image && editor.view.dom.contains(image)) {
    editor.commands.setNodeSelection(editor.view.posAtDOM(image, 0));
    return;
  }
  const cell = target.closest('td, th');
  if (!cell || !editor.view.dom.contains(cell)) return;
  if (!editor.state.selection.empty && editor.isActive('table')) return;
  editor.commands.setTextSelection(editor.view.posAtDOM(cell, 0) + 1);
}
