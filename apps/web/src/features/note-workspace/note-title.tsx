import type { NoteId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Dialog, DialogTrigger, DialogPopup } from '@study/ui/dialog';
import { DialogFormActions } from '@study/ui/dialog-form-actions';
import { DialogHeading } from '@study/ui/dialog-heading';
import { Input } from '@study/ui/input';
import { Notebook } from '@study/ui/note-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
import { Pencil } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { useNoteTitle } from './note-title.queries';
import { NoteError } from './status';

/** Exposes the existing manual title operation beside the note breadcrumb. */
export function NoteTitleEdit({ id, title }: { id: NoteId; title: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(title);
  const mutation = useNoteTitle(id);
  const fieldId = `note-title-${id}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending) return;

        if (next) {
          setDraft(title);
          mutation.reset();
        }

        setOpen(next);
      }}
    >
      <DialogTrigger
        render={<Button variant="ghost-muted" size="icon-sm" />}
        aria-label={t('NoteRename')}
        title={t('NoteRename')}
      >
        <Pencil aria-hidden="true" />
      </DialogTrigger>
      <DialogPopup closeLabel={t('Close')} showCloseButton={!mutation.isPending}>
        <DialogHeading title={<> {t('NoteRename')} </>} />
        <form
          onSubmit={(event) => {
            event.preventDefault();

            if (!draft.trim() || mutation.isPending) return;

            mutation.mutate(draft.trim(), { onSuccess: () => setOpen(false) });
          }}
        >
          <WorkspaceSurface.ContextDialogBody>
            <Notebook.Label htmlFor={fieldId}>{t('NoteName')}</Notebook.Label>
            <Input
              id={fieldId}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={200}
              disabled={mutation.isPending}
            />
            {mutation.error && <NoteError error={mutation.error} />}
          </WorkspaceSurface.ContextDialogBody>
          <DialogFormActions
            cancelLabel={t('Cancel')}
            submitLabel={t(mutation.isPending ? 'NoteSaving' : 'Save')}
            pending={mutation.isPending}
            disabled={!draft.trim()}
          />
        </form>
      </DialogPopup>
    </Dialog>
  );
}
