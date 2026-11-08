import type { ProjectId } from '@study/contracts/ids';
import type { Page } from '@study/contracts/pages/types';
import { Button } from '@study/ui/button';
import { DialogFooter } from '@study/ui/dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { noteKey } from '../note-workspace';
import type { SelectedNote } from '../note-workspace';
import { NotePicker } from './note-picker';
import { PageActionDialog } from './page-action-dialog';
import { pageNoteOptions } from './page-context.queries';

export function PageAiDialog({
  page,
  project,
  onClose
}: {
  page: Page;
  project?: ProjectId;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<SelectedNote[]>([]);
  const mutation = useMutation({
    ...pageNoteOptions(),
    onSuccess: async (_, input) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: noteKey(input.noteId) }),
        cache.invalidateQueries({ queryKey: ['pages'] })
      ]);
      await navigate({
        to: '/notes/$noteId',
        params: { noteId: input.noteId },
        search: project ? { project: String(project) } : {}
      });
      onClose();
    }
  });

  return (
    <PageActionDialog
      pending={mutation.isPending}
      onClose={onClose}
      title={t('PageAskAI')}
      description={t('PageAskAIHelp')}
    >
      <NotePicker
        project={project}
        selected={selected}
        onChange={(notes) => setSelected(notes.slice(-1))}
      />
      {mutation.error && <ContentReadError error={mutation.error} />}
      <DialogFooter>
        <Button
          disabled={!selected[0] || !page.headVersionId || mutation.isPending}
          onClick={() => {
            if (selected[0] && page.headVersionId)
              mutation.mutate({
                pageId: page.id,
                versionId: page.headVersionId,
                noteId: selected[0].id
              });
          }}
        >
          {t('PageOpenAI')}
        </Button>
      </DialogFooter>
    </PageActionDialog>
  );
}
