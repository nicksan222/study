import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { SessionId, SourceId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { WorkspaceAttachments, WorkspaceCard } from '@study/ui/workspace';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { AttachmentCards } from './attachment-cards';
import { notebookMessages } from './notebook-index';
import { SessionDocumentCard } from './session-document-card';
import { sessionDocumentsOptions } from './session-document.queries';
import { SessionPendingWork } from './session-pending-work';
import { threadOptions } from './session-workspace.queries';
import { SessionReadError } from './status';

/** Keeps session actions above the compact list of files and attached documents. */

export function WorkspaceContext({
  id,
  children,
  actions,
  hidden,
  onDismiss,
  onOpenDocument,
  onOpenSource
}: {
  id?: SessionId;
  children?: ReactNode;
  actions?: ReactNode;
  hidden?: boolean;
  onDismiss?: () => void;
  onOpenDocument?: (material: StudyDocumentSummary) => void;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
}) {
  const { t } = useI18n();

  return (
    <WorkspaceCard.Root
      aria-label={t(id ? 'SessionContextPanel' : 'SessionAttachments')}
      variant="attachments"
      hidden={hidden}
      onDismiss={onDismiss}
    >
      {actions}
      <WorkspaceAttachments.Heading>
        <Paperclip size={13} aria-hidden="true" />
        <h2>{t('SessionAttachments')}</h2>
      </WorkspaceAttachments.Heading>
      {id ? (
        <SessionFiles
          key={String(id)}
          id={id}
          onOpenDocument={onOpenDocument}
          onOpenSource={onOpenSource}
        />
      ) : (
        <WorkspaceAttachments.Empty>{t('SessionAttachmentsStart')}</WorkspaceAttachments.Empty>
      )}
      {id && <SessionPendingWork key={String(id)} id={id} />}
      {children}
    </WorkspaceCard.Root>
  );
}

function SessionFiles({
  id,
  onOpenDocument,
  onOpenSource
}: {
  id: SessionId;
  onOpenDocument?: (material: StudyDocumentSummary) => void;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
}) {
  const { t } = useI18n();
  const thread = useInfiniteQuery(threadOptions(id));
  const documents = useQuery(sessionDocumentsOptions(id));
  const messages = notebookMessages(id, thread.data?.pages.flatMap((page) => page.items) ?? []);
  const parts = messages
    .filter((message) => message.format !== 'document')
    .flatMap((message) => message.parts);
  const attached = [
    ...new Map(documents.data?.items.map((material) => [material.id, material])).values()
  ];

  return (
    <WorkspaceAttachments.List aria-label={t('SessionAttachments')}>
      {thread.isPending || documents.isPending ? <Loading label={t('LoadingStudy')} /> : null}
      {thread.error && (
        <SessionReadError error={thread.error} retry={() => void thread.refetch()} />
      )}
      {documents.error && (
        <SessionReadError error={documents.error} retry={() => void documents.refetch()} />
      )}
      {hasNoSessionFiles(
        thread.isSuccess && documents.isSuccess,
        parts.length,
        attached.length,
        !!thread.hasNextPage
      ) && <WorkspaceAttachments.Empty>{t('SessionAttachmentsEmpty')}</WorkspaceAttachments.Empty>}
      <AttachmentCards sessionId={id} parts={parts} compact onOpenSource={onOpenSource} />
      {attached.map((material) => (
        <SessionDocumentCard
          key={String(material.id)}
          sessionId={id}
          document={material}
          active={false}
          compact
          onOpen={(document) => onOpenDocument?.(document)}
        />
      ))}
      {thread.hasNextPage && (
        <Button
          size="sm"
          variant="ghost-muted"
          disabled={thread.isFetchingNextPage}
          onClick={() => void thread.fetchNextPage()}
        >
          {t('SessionEarlierAttachments')}
        </Button>
      )}
    </WorkspaceAttachments.List>
  );
}

function hasNoSessionFiles(ready: boolean, files: number, documents: number, more: boolean) {
  return ready && files === 0 && documents === 0 && !more;
}
