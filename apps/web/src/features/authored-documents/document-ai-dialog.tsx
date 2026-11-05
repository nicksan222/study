import type { StudyDocument } from '@study/contracts/documents/types';
import type { ProjectId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@study/ui/dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { sessionKey } from '../session-workspace';
import type { SelectedSession } from '../session-workspace';
import { documentConversationOptions } from './document-context.queries';
import { SessionPicker } from './session-picker';

export function DocumentAiDialog({
  document,
  project,
  onClose
}: {
  document: StudyDocument;
  project?: ProjectId;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<SelectedSession[]>([]);
  const mutation = useMutation({
    ...documentConversationOptions(),
    onSuccess: async (_, input) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: sessionKey(input.sessionId) }),
        cache.invalidateQueries({ queryKey: ['documents'] })
      ]);
      await navigate({
        to: '/session/$sessionId',
        params: { sessionId: input.sessionId },
        search: project ? { project: String(project) } : {}
      });
      onClose();
    }
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeader>
          <DialogTitle>{t('DocumentAskAI')}</DialogTitle>
          <DialogDescription>{t('DocumentAskAIHelp')}</DialogDescription>
        </DialogHeader>
        <SessionPicker
          project={project}
          selected={selected}
          onChange={(sessions) => setSelected(sessions.slice(-1))}
        />
        {mutation.error && <ContentReadError error={mutation.error} />}
        <DialogFooter>
          <Button
            disabled={!selected[0] || !document.headVersionId || mutation.isPending}
            onClick={() => {
              if (selected[0] && document.headVersionId)
                mutation.mutate({
                  documentId: document.id,
                  versionId: document.headVersionId,
                  sessionId: selected[0].id
                });
            }}
          >
            {t('DocumentOpenAI')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
