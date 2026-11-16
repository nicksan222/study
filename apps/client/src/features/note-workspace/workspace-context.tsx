import type { NoteId, SourceId, PageSummary } from '@study/contracts';
import { AttachmentIcon } from '@study/icons';
import { Button, Loading, WorkspaceAttachments, WorkspaceCard } from '@study/ui';
import type { ReactNode } from 'react';

import { CursorWindowActions } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { AttachmentCards } from './attachment-cards';
import { NotePageCard } from './note-page-card';
import { useLinkedPages } from './note-page.queries';
import { NotePendingWork } from './note-pending-work';
import { useThreadPage } from './note-reads';
import { notebookMessages } from './notebook-index';
import { NoteReadError } from './status';

/** Keeps note actions above the compact list of files and attached pages. */

export function WorkspaceContext({
  id,
  children,
  actions,
  hidden,
  onDismiss,
  onOpenPage,
  onOpenSource
}: {
  id?: NoteId;
  children?: ReactNode;
  actions?: ReactNode;
  hidden?: boolean;
  onDismiss?: () => void;
  onOpenPage?: (material: PageSummary) => void;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
}) {
  const { t } = useI18n();

  return (
    <WorkspaceCard.Root
      aria-label={t(id ? 'NoteContextPanel' : 'NoteAttachments')}
      variant="attachments"
      hidden={hidden}
      onDismiss={onDismiss}
    >
      {actions}
      <WorkspaceAttachments.Heading>
        <AttachmentIcon size={13} aria-hidden="true" />
        <h2>{t('NoteAttachments')}</h2>
      </WorkspaceAttachments.Heading>
      {id ? (
        <NoteFiles key={String(id)} id={id} onOpenPage={onOpenPage} onOpenSource={onOpenSource} />
      ) : (
        <WorkspaceAttachments.Empty>{t('NoteAttachmentsStart')}</WorkspaceAttachments.Empty>
      )}
      {id && <NotePendingWork key={String(id)} id={id} />}
      {children}
    </WorkspaceCard.Root>
  );
}

function NoteFiles({
  id,
  onOpenPage,
  onOpenSource
}: {
  id: NoteId;
  onOpenPage?: (material: PageSummary) => void;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
}) {
  const { t } = useI18n();
  const thread = useThreadPage(id);
  const pages = useLinkedPages(id);
  const messages = notebookMessages(id, thread.data?.items ?? []);
  const parts = messages
    .filter((message) => message.format !== 'document')
    .flatMap((message) => message.parts);
  const attached = [
    ...new Map(pages.data?.items.map((material) => [material.id, material])).values()
  ];

  return (
    <WorkspaceAttachments.List aria-label={t('NoteAttachments')}>
      <NoteFilesFeedback
        thread={thread}
        pages={pages}
        fileCount={parts.length}
        pageCount={attached.length}
      />
      <AttachmentCards noteId={id} parts={parts} compact onOpenSource={onOpenSource} />
      {attached.map((material) => (
        <NotePageCard
          key={String(material.id)}
          noteId={id}
          page={material}
          active={false}
          compact
          onOpen={(page) => onOpenPage?.(page)}
        />
      ))}
      <CursorWindowActions
        hasPrevious={pages.pagination.hasPrevious}
        previous={pages.pagination.previous}
        hasMore={pages.data?.nextCursor != null}
        more={() => pages.pagination.more(pages.data?.nextCursor)}
        pending={pages.isFetching}
      />
      {thread.pagination.hasPrevious && (
        <Button variant="ghost" disabled={thread.isFetching} onClick={thread.pagination.previous}>
          {t('LibraryPrevious')}
        </Button>
      )}
      {thread.hasNextPage && (
        <Button
          size="sm"
          variant="ghost-muted"
          disabled={thread.isFetchingNextPage}
          onClick={() => void thread.fetchNextPage()}
        >
          {t('NoteEarlierAttachments')}
        </Button>
      )}
    </WorkspaceAttachments.List>
  );
}

function hasNoNoteFiles(ready: boolean, files: number, pages: number, more: boolean) {
  return ready && files === 0 && pages === 0 && !more;
}

function NoteFilesFeedback({
  thread,
  pages,
  fileCount,
  pageCount
}: {
  thread: ReturnType<typeof useThreadPage>;
  pages: ReturnType<typeof useLinkedPages>;
  fileCount: number;
  pageCount: number;
}) {
  const { t } = useI18n();

  return (
    <>
      {' '}
      {thread.isPending || pages.isPending ? <Loading label={t('LoadingStudy')} /> : null}
      {thread.error && <NoteReadError error={thread.error} retry={() => void thread.refetch()} />}
      {pages.error && <NoteReadError error={pages.error} retry={() => void pages.refetch()} />}
      {hasNoNoteFiles(
        thread.isSuccess && pages.isSuccess,
        fileCount,
        pageCount,
        !!thread.hasNextPage
      ) && <WorkspaceAttachments.Empty>{t('NoteAttachmentsEmpty')}</WorkspaceAttachments.Empty>}
    </>
  );
}
