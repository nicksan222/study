import type { SessionId } from '@study/contracts/ids';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator
} from '@study/ui/context-menu';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactElement } from 'react';

import { SessionDeleteDialog } from '#web/features/session-workspace/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';

/** Opens deletion for the selected session without activating its navigation link. */
export function SidebarSessionActions({
  id,
  project,
  children
}: {
  id: SessionId;
  project?: string;
  children: ReactElement;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={children} />
        <ContextMenuPopup>
          <ContextMenuItem
            onClick={() => {
              void navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: id },
                search: project ? { project } : {}
              });
            }}
          >
            <ArrowUpRight aria-hidden="true" />
            {t('OpenSession')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" />
            {t('SessionDelete')}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {deleting && <SessionDeleteDialog id={id} open onOpenChange={setDeleting} />}
    </>
  );
}
