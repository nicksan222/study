import type { NoteId } from '@study/contracts/ids';
import { AiIcon } from '@study/ui/ai-button';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator
} from '@study/ui/context-menu';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, FileText, ListChecks, Trash2 } from 'lucide-react';
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
            <ArrowUpRight aria-hidden="true" />
            {t('OpenNote')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setCreating(true)}>
            <FileText aria-hidden="true" />
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
              <ListChecks aria-hidden="true" />
              {t('SidebarSelectNotes')}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" />
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
