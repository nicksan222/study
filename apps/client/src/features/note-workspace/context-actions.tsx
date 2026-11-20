import type { NoteId } from '@study/contracts';
import { OpenIcon, ArchiveIcon, DeleteIcon } from '@study/icons';
import {
  Dialog,
  DialogTrigger,
  SelectionSurface,
  WorkspaceCard,
  WorkspaceChanges
} from '@study/ui';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { ArchivePanel } from './archive';

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

export function NoteContextActions({ id, onDelete }: { id: NoteId; onDelete: () => void }) {
  const { t } = useI18n();

  return (
    <WorkspaceChanges.Actions>
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
