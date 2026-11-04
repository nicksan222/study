import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { SessionId } from '@study/contracts/ids';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { WorkspaceAttachments } from '@study/ui/workspace';
import { FileText } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { DocumentNotebookDeletion } from '../authored-documents/notebook-deletion';
import { ArchiveMenuItem } from './archive-menu-item';
import { ItemContextMenu } from './item-context-menu';
import { ItemDeletionMenu } from './item-deletion-menu';

export function SessionDocumentCard({
  document,
  sessionId,
  onOpen,
  active,
  compact = false
}: {
  document: StudyDocumentSummary;
  sessionId?: SessionId;
  onOpen: (document: StudyDocumentSummary) => void;
  active: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <DocumentNotebookDeletion
      document={document}
      renderActions={(actions) => (
        <ItemContextMenu
          label={t('SessionOpenPage')}
          actions={
            <>
              {sessionId && (
                <ArchiveMenuItem
                  sessionId={sessionId}
                  target={{ kind: 'document', id: document.id }}
                />
              )}
              <ItemDeletionMenu {...actions} />
            </>
          }
          dialogOpen={actions.open}
          target={<button type="button" onClick={() => onOpen(document)} />}
        >
          {compact ? (
            <WorkspaceAttachments.Item
              render={<button type="button" onClick={() => onOpen(document)} />}
            >
              <FileText aria-hidden="true" />
              <span>{document.title}</span>
            </WorkspaceAttachments.Item>
          ) : (
            <Desk.DocumentCard
              title={document.title}
              openLabel={t('SessionOpenPage')}
              preview={document.description}
              meta={t('SourceDocument')}
              active={active}
              onOpen={() => onOpen(document)}
            />
          )}
        </ItemContextMenu>
      )}
    />
  );
}
