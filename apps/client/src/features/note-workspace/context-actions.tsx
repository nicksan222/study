import type { NoteId } from '@study/contracts/ids';
import { OpenIcon, ArchiveIcon, PageIcon, CreatePageIcon, DeleteIcon } from '@study/icons';
import { Dialog, DialogTrigger } from '@study/ui/dialog';
import { SelectionSurface } from '@study/ui/selection';
import { WorkspaceCard, WorkspaceChanges } from '@study/ui/workspace';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { ArchivePanel } from './archive';
import { NotePageDialog } from './page-creation-dialog';

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
          <OpenIcon aria-hidden="true" />
        </>
      </DialogTrigger>
      <SelectionSurface.Popup keepMounted closeLabel={t('Close')} bottomStickOnMobile={false}>
        <SelectionSurface.Title>{title}</SelectionSurface.Title>
        {children}
      </SelectionSurface.Popup>
    </Dialog>
  );
}

export function NoteContextActions({
  id,
  onDelete,
  onCreate,
  pending
}: {
  id: NoteId;
  onDelete: () => void;
  onCreate: () => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);

  return (
    <WorkspaceChanges.Actions>
      <NotePageDialog
        id={id}
        open={creating}
        onOpenChange={setCreating}
        trigger={
          <WorkspaceCard.Primary>
            <PageIcon size={16} aria-hidden="true" />
            {t('NoteTransform')}
          </WorkspaceCard.Primary>
        }
      />
      <WorkspaceCard.Item onClick={onCreate} disabled={pending}>
        <CreatePageIcon aria-hidden="true" />
        <span>{t('NoteNewPage')}</span>
      </WorkspaceCard.Item>
      <ContextAction title={t('NoteArchived')} icon={<ArchiveIcon aria-hidden="true" />}>
        <ArchivePanel id={id} />
      </ContextAction>
      <WorkspaceCard.Item variant="ghost-destructive" onClick={onDelete}>
        <DeleteIcon aria-hidden="true" />
        <span>{t('NoteDelete')}</span>
      </WorkspaceCard.Item>
    </WorkspaceChanges.Actions>
  );
}
