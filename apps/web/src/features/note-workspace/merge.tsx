import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogFooter } from '@study/ui/dialog';
import { DialogDismissButton } from '@study/ui/dialog-form-actions';
import { DialogHeading } from '@study/ui/dialog-heading';
import { Notebook } from '@study/ui/note-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { useNoteMerge } from './merge.queries';
import type { SelectedNote } from './page-creation-dialog';
import { NoteError } from './status';

/** Confirms the exact source set; retries reuse the committed merge identity. */
export function NoteMergeDialog({
  notes,
  onOpenChange,
  onMerged
}: {
  notes: readonly SelectedNote[];
  onOpenChange: (open: boolean) => void;
  onMerged: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const merge = useNoteMerge();
  const [intentKey] = useState(() => crypto.randomUUID());

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!merge.isPending) onOpenChange(open);
      }}
    >
      <DialogPopup closeLabel={t('Close')} showCloseButton={!merge.isPending}>
        <DialogHeading title={t('NoteMerge')} description={t('NoteMergeHelp')} />
        <WorkspaceSurface.ContextDialogBody>
          <ul>
            {notes.map((note) => (
              <li key={String(note.id)}>{note.title}</li>
            ))}
          </ul>
          {merge.error && <NoteError error={merge.error} />}
          {merge.isPending && <Notebook.Status role="status">{t('NoteMerging')}</Notebook.Status>}
        </WorkspaceSurface.ContextDialogBody>
        <DialogFooter>
          <DialogDismissButton label={t('Cancel')} disabled={merge.isPending} />
          <Button
            disabled={merge.isPending || notes.length < 2 || notes.length > 20}
            aria-busy={merge.isPending}
            onClick={() => {
              if (merge.isPending) return;

              merge.mutate(
                { noteIds: notes.map((note) => note.id), intentKey },
                {
                  onSuccess: (note) => {
                    onMerged();
                    onOpenChange(false);
                    void navigate({
                      to: '/notes/$noteId',
                      params: { noteId: note.id },
                      search: note.projectIds[0] ? { project: String(note.projectIds[0]) } : {}
                    });
                  }
                }
              );
            }}
          >
            {t(merge.isPending ? 'NoteMerging' : 'NoteMerge')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
