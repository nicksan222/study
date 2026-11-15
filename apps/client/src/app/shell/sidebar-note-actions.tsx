import type { NoteId } from '@study/contracts';
import { OpenIcon, PageIcon, ChecklistIcon, DeleteIcon } from '@study/icons';
import {
  AiIcon,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator
} from '@study/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactElement } from 'react';

import {
  NoteDeleteDialog,
  NotePageDialog,
  useRegenerateNoteTitle
} from '#client/features/note-workspace/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

/** Offers note actions without activating the row's navigation link. */
export function SidebarNoteActions({
  id,
  project,
  onSelect,
  children
}: {
  id: NoteId;
  project?: string;
  onSelect?: () => void;
  children: ReactElement;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const title = useRegenerateNoteTitle(id);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState<boolean>();

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={children} />
        <ContextMenuPopup>
          <ContextMenuItem
            onClick={() => {
              void navigate({
                to: '/notes/$noteId',
                params: { noteId: id },
                search: project ? { project } : {}
              });
            }}
          >
            <OpenIcon aria-hidden="true" />
            {t('OpenNote')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setCreating(true)}>
            <PageIcon aria-hidden="true" />
            {t('NoteTransform')}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={title.pending || title.readiness !== 'ready'}
            onClick={title.regenerate}
            title={title.readiness === 'setup' ? t('AiReadinessSetup') : undefined}
          >
            <AiIcon working={title.pending} />
            {t('RegenerateTitle')}
          </ContextMenuItem>
          {onSelect && (
            <ContextMenuItem onClick={onSelect}>
              <ChecklistIcon aria-hidden="true" />
              {t('SidebarSelectNotes')}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <DeleteIcon aria-hidden="true" />
            {t('NoteDelete')}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {creating !== undefined && (
        <NotePageDialog id={id} open={creating} onOpenChange={setCreating} />
      )}
      {deleting && <NoteDeleteDialog id={id} open onOpenChange={setDeleting} />}
    </>
  );
}
