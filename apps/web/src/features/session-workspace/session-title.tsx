import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Dialog, DialogTrigger, DialogPopup, DialogHeader, DialogTitle } from '@study/ui/dialog';
import { DialogFormActions } from '@study/ui/dialog-form-actions';
import { Input } from '@study/ui/input';
import { Notebook } from '@study/ui/session-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
import { Pencil } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { useSessionTitle } from './session-title.queries';
import { SessionError } from './status';

/** Exposes the existing manual title operation beside the session breadcrumb. */
export function SessionTitleEdit({ id, title }: { id: SessionId; title: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(title);
  const mutation = useSessionTitle(id);
  const fieldId = `session-title-${id}`;

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
        aria-label={t('SessionRename')}
        title={t('SessionRename')}
      >
        <Pencil aria-hidden="true" />
      </DialogTrigger>
      <DialogPopup closeLabel={t('Close')} showCloseButton={!mutation.isPending}>
        <DialogHeader>
          <DialogTitle>{t('SessionRename')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();

            if (!draft.trim() || mutation.isPending) return;

            mutation.mutate(draft.trim(), { onSuccess: () => setOpen(false) });
          }}
        >
          <WorkspaceSurface.ContextDialogBody>
            <Notebook.Label htmlFor={fieldId}>{t('SessionTitle')}</Notebook.Label>
            <Input
              id={fieldId}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={200}
              disabled={mutation.isPending}
            />
            {mutation.error && <SessionError error={mutation.error} />}
          </WorkspaceSurface.ContextDialogBody>
          <DialogFormActions
            cancelLabel={t('Cancel')}
            submitLabel={t(mutation.isPending ? 'SessionSaving' : 'Save')}
            pending={mutation.isPending}
            disabled={!draft.trim()}
          />
        </form>
      </DialogPopup>
    </Dialog>
  );
}
