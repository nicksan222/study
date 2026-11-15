import type { ProjectId } from '@study/contracts/ids';
import type { Page } from '@study/contracts/pages/types';
import { useIndependentMutation } from '@study/contracts/react';
import { Button } from '@study/ui/button';
import { DialogFooter } from '@study/ui/dialog';
import { useNavigate } from '@tanstack/react-router';
import { Effect } from 'effect';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { ContentReadError } from '../document-presentation';
import type { SelectedNote } from '../note-workspace';
import { NotePicker } from './note-picker';
import { PageActionDialog } from './page-action-dialog';
import { attachPageToNote } from './page-context.queries';

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
  const navigate = useNavigate();
  const [selected, setSelected] = useState<SelectedNote[]>([]);
  const mutation = useIndependentMutation((input: Parameters<typeof attachPageToNote>[0]) =>
    Effect.tryPromise({
      try: async () => {
        await attachPageToNote(input);
        await navigate({
          to: '/notes/$noteId',
          params: { noteId: input.noteId },
          search: project ? { project: String(project) } : {}
        });
        onClose();
      },
      catch: toStudyError
    })
  );

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
              void mutation.mutate({
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
