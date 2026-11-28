import type { NoteId, ProjectId } from '@study/contracts';
import { OpenIcon, ArchiveIcon, DeleteIcon, HistoryIcon, PageIcon } from '@study/icons';
import {
  Dialog,
  DialogTrigger,
  SelectionSurface,
  WorkspaceCard,
  WorkspaceChanges
} from '@study/ui';
import { Link } from '@tanstack/react-router';
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

export function NoteContextActions({
  id,
  project,
  onHistory,
  onDelete
}: {
  id: NoteId;
  project?: ProjectId;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();

  return (
    <WorkspaceChanges.Actions>
      <WorkspaceCard.Group>
        <WorkspaceCard.Primary
          render={<Link to="/practice" search={project ? { project: String(project) } : {}} />}
        >
          <PageIcon aria-hidden="true" />
          {t('PracticeStudyNotes')}
        </WorkspaceCard.Primary>
      </WorkspaceCard.Group>
      <WorkspaceCard.Group>
        <WorkspaceCard.Item onClick={onHistory}>
          <HistoryIcon aria-hidden="true" />
          <span>{t('NoteHistory')}</span>
        </WorkspaceCard.Item>
        <ContextAction title={t('NoteArchived')} icon={<ArchiveIcon aria-hidden="true" />}>
          <ArchivePanel id={id} />
        </ContextAction>
      </WorkspaceCard.Group>
      <WorkspaceCard.Group>
        <WorkspaceCard.Item variant="ghost-destructive" onClick={onDelete}>
          <DeleteIcon aria-hidden="true" />
          <span>{t('NoteDelete')}</span>
        </WorkspaceCard.Item>
      </WorkspaceCard.Group>
    </WorkspaceChanges.Actions>
  );
}
