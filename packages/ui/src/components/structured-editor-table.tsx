import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Grid2X2, Table2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from './button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { Input } from './input';
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from './menu';
import { tableEditorActions } from './structured-editor-table-actions';
import type { StructuredEditorLabels } from './structured-editor-types';

export function StructuredTableControls({
  editor,
  labels,
  disabled,
  onInsert
}: {
  editor: Editor;
  labels: StructuredEditorLabels;
  disabled: boolean;
  onInsert: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      active: current.isActive('table'),
      merge: current.can().mergeCells(),
      split: current.can().splitCell(),
      selection: current.state.selection.toJSON()
    })
  });
  const actions = tableEditorActions(editor).filter((action) => action.key !== 'deleteTable');

  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost-muted"
        aria-label={labels.insertTable}
        title={labels.insertTable}
        disabled={disabled}
        onClick={onInsert}
      >
        <Table2 size={16} aria-hidden="true" />
      </Button>
      {state.active && (
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost-muted"
                disabled={disabled}
                aria-label={labels.table}
                title={labels.table}
              />
            }
          >
            <Grid2X2 size={16} aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="start">
            {actions.map(({ key, run, enabled }) => (
              <MenuItem key={key} disabled={!enabled} onClick={run}>
                {labels[key]}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              {labels.deleteTable}
            </MenuItem>
          </MenuPopup>
        </Menu>
      )}
    </>
  );
}

export function StructuredTableDialog({
  editor,
  labels,
  open,
  onOpenChange
}: {
  editor: Editor;
  labels: StructuredEditorLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup closeLabel={labels.cancel} className="structured-editor-insert-dialog">
        <DialogHeader>
          <DialogTitle>{labels.insertTable}</DialogTitle>
        </DialogHeader>
        <TableForm editor={editor} labels={labels} close={() => onOpenChange(false)} />
      </DialogPopup>
    </Dialog>
  );
}

function TableForm({
  editor,
  labels,
  close
}: {
  editor: Editor;
  labels: StructuredEditorLabels;
  close: () => void;
}) {
  const [rows, setRows] = useState('3');
  const [columns, setColumns] = useState('3');
  const [header, setHeader] = useState(true);
  const valid = [rows, columns].every(
    (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 20
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();

        if (!valid) return;

        editor
          .chain()
          .focus()
          .insertTable({ rows: Number(rows), cols: Number(columns), withHeaderRow: header })
          .run();
        close();
      }}
    >
      <div className="structured-editor-insert-fields">
        <div className="structured-editor-table-size">
          <label>
            {labels.rows}
            <Input
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(event) => setRows(event.target.value)}
            />
          </label>
          <label>
            {labels.columns}
            <Input
              type="number"
              min={1}
              max={20}
              value={columns}
              onChange={(event) => setColumns(event.target.value)}
            />
          </label>
        </div>
        <label className="structured-editor-header-option">
          <input
            type="checkbox"
            checked={header}
            onChange={(event) => setHeader(event.target.checked)}
          />
          {labels.headerRow}
        </label>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>
          {labels.cancel}
        </Button>
        <Button type="submit" disabled={!valid}>
          {labels.insertTable}
        </Button>
      </DialogFooter>
    </form>
  );
}
