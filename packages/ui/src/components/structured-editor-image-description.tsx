import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import type { ComponentProps } from 'react';

import { Button } from './button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { Input } from './input';
import type { StructuredEditorLabels } from './structured-editor-types';

export function StructuredImageDescription({
  editor,
  position,
  labels,
  open,
  onOpenChange
}: {
  editor: Editor;
  position: number;
  labels: StructuredEditorLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup closeLabel={labels.cancel} className="structured-editor-insert-dialog">
        {open && (
          <DialogForm
            editor={editor}
            labels={labels}
            onOpenChange={onOpenChange}
            position={position}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function DialogForm({
  editor,
  labels,
  onOpenChange,
  position
}: Omit<ComponentProps<typeof StructuredImageDescription>, 'open'>) {
  const [alt, setAlt] = useState(() => String(editor.state.doc.nodeAt(position)?.attrs.alt ?? ''));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{labels.imageDescription}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();

          if (editor.state.doc.nodeAt(position)?.type.name === 'image')
            editor
              .chain()
              .focus()
              .setNodeSelection(position)
              .updateAttributes('image', { alt })
              .run();

          onOpenChange(false);
        }}
      >
        <div className="structured-editor-insert-fields">
          <label>
            {labels.imageDescription}
            <Input value={alt} onChange={(event) => setAlt(event.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="submit">{labels.saveDescription}</Button>
        </DialogFooter>
      </form>
    </>
  );
}
