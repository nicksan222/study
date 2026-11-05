import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import type { ComponentProps } from 'react';

import { Button } from './button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { Input } from './input';
import type { StructuredEditorLabels } from './structured-editor-types';

export function StructuredLinkDialog({
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
        {open && <DialogForm editor={editor} labels={labels} onOpenChange={onOpenChange} />}
      </DialogPopup>
    </Dialog>
  );
}

function DialogForm({
  editor,
  labels,
  onOpenChange
}: Omit<ComponentProps<typeof StructuredLinkDialog>, 'open'>) {
  const [url, setUrl] = useState(() => String(editor.getAttributes('link').href ?? ''));

  let valid = false;

  try {
    valid = ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    /* An incomplete URL keeps the form disabled. */
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{labels.link}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();

          if (!valid) return;

          const chain = editor.chain().focus().extendMarkRange('link');

          if (editor.state.selection.empty && !editor.isActive('link'))
            chain
              .insertContent({
                type: 'text',
                text: url,
                marks: [{ type: 'link', attrs: { href: url } }]
              })
              .run();
          else chain.setLink({ href: url }).run();

          onOpenChange(false);
        }}
      >
        <div className="structured-editor-insert-fields">
          <label>
            {labels.linkUrl}
            <Input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              aria-invalid={url.length > 0 && !valid}
            />
          </label>
          {url.length > 0 && !valid && <p role="status">{labels.invalidLink}</p>}
        </div>
        <DialogFooter>
          {editor.isActive('link') && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                onOpenChange(false);
              }}
            >
              {labels.removeLink}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="submit" disabled={!valid}>
            {labels.saveLink}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
