import type { Editor } from '@tiptap/core';

const commands = [
  'addRowBefore',
  'addRowAfter',
  'deleteRow',
  'addColumnBefore',
  'addColumnAfter',
  'deleteColumn',
  'toggleHeaderRow',
  'mergeCells',
  'splitCell',
  'deleteTable'
] as const;

export function tableEditorActions(editor: Editor) {
  return commands.map((key) => ({
    key,
    enabled: editor.can()[key](),
    run: () => editor.chain().focus()[key]().run()
  }));
}
