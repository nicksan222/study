import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogFooter
} from '@study/ui/dialog';
import { WorkspaceCard, WorkspaceSurface, WorkspaceChanges } from '@study/ui/workspace';
import { ArrowUpRight, FileInput, FileText, FilePlus2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { SessionDocumentDialog } from './document-creation-dialog';
import { SelectionPanel } from './selection';

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
        variant="workspace-context"
        bottomStickOnMobile={false}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <WorkspaceSurface.ContextDialogBody>
          <WorkspaceSurface.Container>{children}</WorkspaceSurface.Container>
        </WorkspaceSurface.ContextDialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('Close')}</DialogClose>
        </DialogFooter>
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
      <ContextAction title={t('SessionSelection')} icon={<FileInput aria-hidden="true" />}>
        <SelectionPanel id={id} />
      </ContextAction>
      <WorkspaceCard.Item variant="ghost-destructive" onClick={onDelete}>
        <Trash2 aria-hidden="true" />
        <span>{t('SessionDelete')}</span>
      </WorkspaceCard.Item>
    </WorkspaceChanges.Actions>
  );
}
