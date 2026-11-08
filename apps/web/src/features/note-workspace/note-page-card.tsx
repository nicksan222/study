import type { NoteId } from '@study/contracts/ids';
import type { PageSummary } from '@study/contracts/pages/types';
import { ChatEntryLabel } from '@study/ui/chat';
import { WorkspaceAttachments } from '@study/ui/workspace';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { FileText } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { PageNotebookDeletion } from '../document-editing';
import { ArchiveMenuItem } from './archive-menu-item';
import { ItemContextMenu } from './item-context-menu';
import { ItemDeletionMenu } from './item-deletion-menu';

export function NotePageCard({
  page,
  noteId,
  onOpen,
  active,
  compact = false
}: {
  page: PageSummary;
  noteId?: NoteId;
  onOpen: (page: PageSummary) => void;
  active: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <PageNotebookDeletion
      page={page}
      renderActions={(actions) => (
        <ItemContextMenu
          label={t('NoteOpenPage')}
          actions={
            <>
              {noteId && <ArchiveMenuItem noteId={noteId} target={{ kind: 'page', id: page.id }} />}
              <ItemDeletionMenu {...actions} />
            </>
          }
          dialogOpen={actions.open}
          target={
            <button type="button" aria-label={t('NoteOpenPage')} onClick={() => onOpen(page)} />
          }
        >
          {compact ? (
            <WorkspaceAttachments.Item
              render={
                <button type="button" aria-label={t('NoteOpenPage')} onClick={() => onOpen(page)} />
              }
              title={page.title}
              label={page.title}
              meta={page.description ?? t('SourcePage')}
              icon={<FileText aria-hidden="true" />}
              tone="blue"
            />
          ) : (
            <>
              <ChatEntryLabel>{t('NoteEntryPage')}</ChatEntryLabel>
              <Desk.PageCard
                title={page.title}
                openLabel={t('NoteOpenPage')}
                preview={page.description}
                active={active}
                onOpen={() => onOpen(page)}
              />
            </>
          )}
        </ItemContextMenu>
      )}
    />
  );
}
