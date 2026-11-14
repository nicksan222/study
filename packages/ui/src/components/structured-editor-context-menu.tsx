import {
  BoldIcon,
  CopyIcon,
  PasteIcon,
  CutIcon,
  ItalicIcon,
  StrikethroughIcon,
  ClearFormattingIcon,
  UndoIcon,
  RedoIcon,
  SelectAllIcon,
  DeleteIcon,
  LinkIcon,
  InsertImageIcon,
  InsertTableIcon,
  ImagePropertiesIcon
} from '@study/icons';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator
} from './context-menu';
import { copyEditorSelection, pasteIntoEditor } from './structured-editor-clipboard';
import { selectContextTarget } from './structured-editor-context-selection';
import { tableEditorActions } from './structured-editor-table-actions';
import type { StructuredEditorLabels } from './structured-editor-types';

export function StructuredEditorContextMenu({
  editor,
  labels,
  disabled,
  onInsertTable,
  onEditLink,
  onInsertImage,
  onEditImage,
  upload,
  children
}: {
  editor: Editor;
  labels: StructuredEditorLabels;
  disabled: boolean;
  onInsertTable: () => void;
  onEditLink: () => void;
  onInsertImage?: () => void;
  onEditImage: () => void;
  upload?: (files: File[]) => void;
  children: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      selected: !current.state.selection.empty,
      table: current.isActive('table'),
      image: current.isActive('image'),
      merge: current.can().mergeCells(),
      split: current.can().splitCell(),
      undo: current.can().undo(),
      redo: current.can().redo()
    })
  });
  const formatting = [
    ['bold', BoldIcon, () => editor.chain().focus().toggleBold().run()],
    ['italic', ItalicIcon, () => editor.chain().focus().toggleItalic().run()],
    ['strike', StrikethroughIcon, () => editor.chain().focus().toggleStrike().run()],
    ['clear', ClearFormattingIcon, () => editor.chain().focus().unsetAllMarks().run()]
  ] as const;

  async function clipboard(action: () => Promise<void>) {
    setFailed(false);

    try {
      await action();
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          tabIndex={-1}
          onContextMenu={(event) => {
            event.stopPropagation();
            selectContextTarget(editor, event.target);
          }}
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuPopup aria-label={labels.contextMenu} finalFocus={() => editor.view.dom}>
          <ContextMenuItem
            disabled={disabled || !state.selected}
            onClick={() => void clipboard(() => copyEditorSelection(editor, true))}
          >
            <CutIcon aria-hidden="true" />
            {labels.cut}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!state.selected}
            onClick={() => void clipboard(() => copyEditorSelection(editor, false))}
          >
            <CopyIcon aria-hidden="true" />
            {labels.copy}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={disabled}
            onClick={() => void clipboard(() => pasteIntoEditor(editor, upload))}
          >
            <PasteIcon aria-hidden="true" />
            {labels.paste}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {state.image ? (
            <>
              <ContextMenuItem disabled={disabled} onClick={onEditImage}>
                <ImagePropertiesIcon aria-hidden="true" />
                {labels.imageDescription}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={disabled}
                variant="destructive"
                onClick={() => editor.chain().focus().deleteSelection().run()}
              >
                <DeleteIcon aria-hidden="true" />
                {labels.deleteImage}
              </ContextMenuItem>
            </>
          ) : (
            <>
              {state.selected &&
                formatting.map(([key, Icon, run]) => (
                  <ContextMenuItem key={key} disabled={disabled} onClick={run}>
                    <Icon aria-hidden="true" />
                    {labels[key]}
                  </ContextMenuItem>
                ))}
              <ContextMenuItem disabled={disabled} onClick={onEditLink}>
                <LinkIcon aria-hidden="true" />
                {labels.link}
              </ContextMenuItem>
            </>
          )}
          {state.table && (
            <>
              <ContextMenuSeparator />
              {tableEditorActions(editor).map(({ key, run, enabled }) => (
                <ContextMenuItem
                  key={key}
                  disabled={disabled || !enabled}
                  variant={key === 'deleteTable' ? 'destructive' : 'default'}
                  onClick={run}
                >
                  {labels[key]}
                </ContextMenuItem>
              ))}
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem disabled={disabled} onClick={onInsertTable}>
            <InsertTableIcon aria-hidden="true" />
            {labels.insertTable}
          </ContextMenuItem>
          {onInsertImage && (
            <ContextMenuItem disabled={disabled} onClick={onInsertImage}>
              <InsertImageIcon aria-hidden="true" />
              {labels.image}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={disabled || !state.undo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <UndoIcon aria-hidden="true" />
            {labels.undo}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={disabled || !state.redo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <RedoIcon aria-hidden="true" />
            {labels.redo}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => editor.chain().focus().selectAll().run()}>
            <SelectAllIcon aria-hidden="true" />
            {labels.selectAll}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {failed && (
        <p role="alert" className="structured-editor-notice">
          {labels.clipboardError}
        </p>
      )}
    </>
  );
}
