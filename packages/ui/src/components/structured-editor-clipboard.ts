import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';

/** Uses ProseMirror's clipboard serializer/parser so copied tables and marks keep their structure. */
export async function copyEditorSelection(editor: Editor, cut: boolean) {
  const slice = editor.state.selection.content();
  const serialized = editor.view.serializeForClipboard(slice);
  let bookmark = editor.state.selection.getBookmark();
  const map = ({ transaction }: { transaction: Transaction }) => {
    bookmark = bookmark.map(transaction.mapping);
  };
  editor.on('transaction', map);

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([serialized.dom.innerHTML], { type: 'text/html' }),
          'text/plain': new Blob([serialized.text], { type: 'text/plain' })
        })
      ]);
    } else await navigator.clipboard.writeText(serialized.text);

    if (cut && !editor.isDestroyed && editor.isEditable) {
      const selection = bookmark.resolve(editor.state.doc);
      if (!selection.content().eq(slice)) throw new Error('The selected content changed');
      editor.view.dispatch(
        editor.state.tr.setSelection(selection).deleteSelection().scrollIntoView()
      );
      editor.commands.focus();
    }
  } finally {
    editor.off('transaction', map);
  }
}

export async function pasteIntoEditor(editor: Editor, upload?: (files: File[]) => void) {
  if (navigator.clipboard.read) {
    for (const item of await navigator.clipboard.read()) {
      if (await pasteItem(editor, item, upload)) return;
    }
  } else {
    const text = await navigator.clipboard.readText();
    if (!editor.isDestroyed && editor.isEditable) {
      editor.commands.focus();
      editor.view.pasteText(text);
    }
  }
}

async function pasteItem(editor: Editor, item: ClipboardItem, upload?: (files: File[]) => void) {
  const image = item.types.find((type) => type.startsWith('image/'));
  if (image && upload) {
    const blob = await item.getType(image);
    if (!editor.isDestroyed && editor.isEditable)
      upload([new File([blob], 'clipboard-image', { type: image })]);
    return true;
  }
  const format = ['text/html', 'text/plain'].find((type) => item.types.includes(type));
  if (!format) return false;
  const text = await (await item.getType(format)).text();
  if (editor.isDestroyed || !editor.isEditable) return true;
  editor.commands.focus();
  if (format === 'text/html') editor.view.pasteHTML(text);
  else editor.view.pasteText(text);
  return true;
}
