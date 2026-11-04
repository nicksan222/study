import type { SessionId } from '@study/contracts/ids';
import { Dialog, DialogTrigger, DialogPopup, DialogTitle } from '@study/ui/dialog';
import { WorkspaceCard, WorkspaceChanges } from '@study/ui/workspace';
import { ArrowUpRight, Archive, FileText, FilePlus2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { ArchivePanel } from './archive';
import { SessionDocumentDialog } from './document-creation-dialog';

function ContextAction({
  title,
  icon,
  children
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <Dialog>
      <DialogTrigger aria-label={title} render={<WorkspaceCard.Item />}>
        {icon}
        <>
          <span>{title}</span>
          <ArrowUpRight aria-hidden="true" />
        </>
      </DialogTrigger>
      <DialogPopup
        keepMounted
        closeLabel={t('Close')}
        className="settings-popup ui-selection-dialog"
        viewportClassName="settings-viewport"
        bottomStickOnMobile={false}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogPopup>
    </Dialog>
  );
}

export function SessionContextActions({
  id,
  onDelete,
  onCreate,
  pending
}: {
  id: SessionId;
  onDelete: () => void;
  onCreate: () => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);

  return (
    <WorkspaceChanges.Actions>
      <SessionDocumentDialog
        id={id}
        open={creating}
        onOpenChange={setCreating}
        trigger={
          <WorkspaceCard.Primary>
            <FileText size={16} aria-hidden="true" />
            {t('SessionTransform')}
          </WorkspaceCard.Primary>
        }
      />
      <WorkspaceCard.Item onClick={onCreate} disabled={pending}>
        <FilePlus2 aria-hidden="true" />
        <span>{t('SessionNewDocument')}</span>
      </WorkspaceCard.Item>
      <ContextAction title={t('SessionArchived')} icon={<Archive aria-hidden="true" />}>
        <ArchivePanel id={id} />
      </ContextAction>
      <WorkspaceCard.Item variant="ghost-destructive" onClick={onDelete}>
        <Trash2 aria-hidden="true" />
        <span>{t('SessionDelete')}</span>
      </WorkspaceCard.Item>
    </WorkspaceChanges.Actions>
  );
}
