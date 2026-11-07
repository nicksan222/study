import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogFooter } from '@study/ui/dialog';
import { DialogDismissButton } from '@study/ui/dialog-form-actions';
import { DialogHeading } from '@study/ui/dialog-heading';
import { Notebook } from '@study/ui/session-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import type { SelectedSession } from './document-creation-dialog';
import { useSessionMerge } from './merge.queries';
import { SessionError } from './status';

/** Confirms the exact source set; retries reuse the committed merge identity. */
export function SessionMergeDialog({
  sessions,
  onOpenChange,
  onMerged
}: {
  sessions: readonly SelectedSession[];
  onOpenChange: (open: boolean) => void;
  onMerged: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const merge = useSessionMerge();
  const [intentKey] = useState(() => crypto.randomUUID());

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!merge.isPending) onOpenChange(open);
      }}
    >
      <DialogPopup closeLabel={t('Close')} showCloseButton={!merge.isPending}>
        <DialogHeading title={t('SessionMerge')} description={t('SessionMergeHelp')} />
        <WorkspaceSurface.ContextDialogBody>
          <ul>
            {sessions.map((session) => (
              <li key={String(session.id)}>{session.title}</li>
            ))}
          </ul>
          {merge.error && <SessionError error={merge.error} />}
          {merge.isPending && (
            <Notebook.Status role="status">{t('SessionMerging')}</Notebook.Status>
          )}
        </WorkspaceSurface.ContextDialogBody>
        <DialogFooter>
          <DialogDismissButton label={t('Cancel')} disabled={merge.isPending} />
          <Button
            disabled={merge.isPending || sessions.length < 2 || sessions.length > 20}
            aria-busy={merge.isPending}
            onClick={() => {
              if (merge.isPending) return;

              merge.mutate(
                { sessionIds: sessions.map((session) => session.id), intentKey },
                {
                  onSuccess: (session) => {
                    onMerged();
                    onOpenChange(false);
                    void navigate({
                      to: '/session/$sessionId',
                      params: { sessionId: session.id },
                      search: session.projectIds[0]
                        ? { project: String(session.projectIds[0]) }
                        : {}
                    });
                  }
                }
              );
            }}
          >
            {t(merge.isPending ? 'SessionMerging' : 'SessionMerge')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
