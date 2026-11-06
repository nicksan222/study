import type { SessionId } from '@study/contracts/ids';
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
  SessionDeleteDialog,
  SessionDocumentDialog,
  useRegenerateSessionTitle
} from '#web/features/session-workspace/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';

/** Offers session actions without activating the row's navigation link. */
export function SidebarSessionActions({
  id,
  project,
  onSelect,
  children
}: {
  id: SessionId;
  project?: string;
  onSelect?: () => void;
  children: ReactElement;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const title = useRegenerateSessionTitle(id);
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
                to: '/session/$sessionId',
                params: { sessionId: id },
                search: project ? { project } : {}
              });
            }}
          >
            <ArrowUpRight aria-hidden="true" />
            {t('OpenSession')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setCreating(true)}>
            <FileText aria-hidden="true" />
            {t('SessionTransform')}
          </ContextMenuItem>
          <ContextMenuItem disabled={title.pending} onClick={title.regenerate}>
            <AiIcon working={title.pending} />
            {t('RegenerateTitle')}
          </ContextMenuItem>
          {onSelect && (
            <ContextMenuItem onClick={onSelect}>
              <ListChecks aria-hidden="true" />
              {t('SidebarSelectSessions')}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" />
            {t('SessionDelete')}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {creating !== undefined && (
        <SessionDocumentDialog id={id} open={creating} onOpenChange={setCreating} />
      )}
      {deleting && <SessionDeleteDialog id={id} open onOpenChange={setDeleting} />}
    </>
  );
}
