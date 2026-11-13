import type { NoteId, SourceId } from '@study/contracts/ids';
import type { PageSummary } from '@study/contracts/pages/types';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { WorkspaceAttachments, WorkspaceCard } from '@study/ui/workspace';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { AttachmentCards } from './attachment-cards';
import { NotePageCard } from './note-page-card';
import { linkedPagesOptions } from './note-page.queries';
import { NotePendingWork } from './note-pending-work';
import { threadOptions } from './note-workspace.queries';
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
        <Paperclip size={13} aria-hidden="true" />
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
  const thread = useInfiniteQuery(threadOptions(id));
  const pages = useQuery(linkedPagesOptions(id));
  const messages = notebookMessages(id, thread.data?.pages.flatMap((page) => page.items) ?? []);
  const parts = messages
    .filter((message) => message.format !== 'document')
    .flatMap((message) => message.parts);
  const attached = [
    ...new Map(pages.data?.items.map((material) => [material.id, material])).values()
  ];

  return (
    <WorkspaceAttachments.List aria-label={t('NoteAttachments')}>
      {thread.isPending || pages.isPending ? <Loading label={t('LoadingStudy')} /> : null}
      {thread.error && <NoteReadError error={thread.error} retry={() => void thread.refetch()} />}
      {pages.error && <NoteReadError error={pages.error} retry={() => void pages.refetch()} />}
      {hasNoNoteFiles(
        thread.isSuccess && pages.isSuccess,
        parts.length,
        attached.length,
        !!thread.hasNextPage
      ) && <WorkspaceAttachments.Empty>{t('NoteAttachmentsEmpty')}</WorkspaceAttachments.Empty>}
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
