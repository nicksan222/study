import type { NoteId } from '@study/contracts';
import {
  AnswerQuestionIcon,
  AttachmentIcon,
  BulletListIcon,
  ComposeIcon,
  PageIcon,
  ReplyIcon
} from '@study/icons';
import { Button, Loading, WorkspaceAttachments } from '@study/ui';
import { useLayoutEffect, useState } from 'react';

import { CursorWindowActions } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { NoteSummary } from './note-editor';
import type { useLinkedPages } from './note-page.queries';
import type { useThreadPage } from './note-reads';
import {
  jumpToNotebookTarget,
  notebookMessages,
  notebookTargetId,
  notebookTimeline
} from './notebook-index';
import { messageSectionTitle } from './section-title';
import { NoteReadError } from './status';
import { usePhoneLayout } from './use-phone-layout';

/** Uses the board's exact query windows so every outline target is present in the notebook. */
export function NotebookOutline({
  id,
  thread,
  pages,
  onNavigate
}: {
  id: NoteId;
  onNavigate?: () => void;
  thread: ReturnType<typeof useThreadPage>;
  pages: ReturnType<typeof useLinkedPages>;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState<string>();
  const [navigation, setNavigation] = useState<{ target: string }>();
  const phone = usePhoneLayout();

  useLayoutEffect(() => {
    if (navigation) jumpToNotebookTarget(navigation.target);
  }, [navigation]);
  const entries = notebookTimeline(
    notebookMessages(id, thread.data?.items ?? []),
    pages.data?.items ?? []
  );

  return (
    <WorkspaceAttachments.Outline aria-label={t('NoteOutline')}>
      <WorkspaceAttachments.Heading>
        <BulletListIcon size={13} aria-hidden="true" />
        <h2>{t('NoteOutline')}</h2>
      </WorkspaceAttachments.Heading>
      <OutlineScope thread={thread} pages={pages} />
      <WorkspaceAttachments.OutlineList>
        {entries.map((entry) => {
          const target = notebookTargetId(
            id,
            entry.kind,
            entry.kind === 'page' ? entry.page.id : entry.message.id
          );

          return (
            <li key={target}>
              <WorkspaceAttachments.OutlineItem
                icon={<OutlineIcon entry={entry} />}
                aria-current={active === target ? 'location' : undefined}
                onClick={() => {
                  setActive(target);

                  if (phone) onNavigate?.();

                  setNavigation({ target });
                }}
              >
                <OutlineLabel entry={entry} />
              </WorkspaceAttachments.OutlineItem>
            </li>
          );
        })}
      </WorkspaceAttachments.OutlineList>
      <OutlineFeedback thread={thread} pages={pages} empty={entries.length === 0} />
    </WorkspaceAttachments.Outline>
  );
}

function OutlineIcon({ entry }: { entry: ReturnType<typeof notebookTimeline>[number] }) {
  if (entry.kind === 'page' || entry.message.format === 'document')
    return <PageIcon aria-hidden="true" />;

  if (entry.message.role === 'assistant') return <ReplyIcon aria-hidden="true" />;

  if (entry.message.question?.kind === 'question') return <AnswerQuestionIcon aria-hidden="true" />;

  if (
    !entry.message.versions.some(
      (version) => version.id === entry.message.activeVersionId && version.text.trim()
    ) &&
    entry.message.parts.length > 0
  )
    return <AttachmentIcon aria-hidden="true" />;

  return <ComposeIcon aria-hidden="true" />;
}

function OutlineScope({
  thread,
  pages
}: {
  thread: ReturnType<typeof useThreadPage>;
  pages: ReturnType<typeof useLinkedPages>;
}) {
  const { t } = useI18n();
  const partial =
    thread.pagination.hasPrevious ||
    thread.hasNextPage ||
    pages.pagination.hasPrevious ||
    pages.data?.nextCursor != null;

  return partial ? (
    <WorkspaceAttachments.OutlineScope>{t('NoteOutlineScope')}</WorkspaceAttachments.OutlineScope>
  ) : null;
}

function OutlineLabel({ entry }: { entry: ReturnType<typeof notebookTimeline>[number] }) {
  const { t } = useI18n();

  if (entry.kind === 'page') return entry.page.title || t('NoteNewPage');

  const message = entry.message;
  const version = message.versions.find((item) => item.id === message.activeVersionId);
  const title = messageSectionTitle(message);
  const fallback =
    message.parts[0]?.sourceName ||
    t(
      message.format === 'document'
        ? 'NoteNewPage'
        : message.role === 'assistant'
          ? 'NoteReply'
          : 'NoteNote'
    );

  return title ?? <NoteSummary value={version?.text ?? ''} fallback={fallback} />;
}

function OutlineFeedback({
  thread,
  pages,
  empty
}: {
  thread: ReturnType<typeof useThreadPage>;
  pages: ReturnType<typeof useLinkedPages>;
  empty: boolean;
}) {
  const { t } = useI18n();

  return (
    <WorkspaceAttachments.OutlineFeedback>
      {(thread.isPending || pages.isPending) && <Loading label={t('LoadingStudy')} />}
      {thread.error && <NoteReadError error={thread.error} retry={() => void thread.refetch()} />}
      {pages.error && <NoteReadError error={pages.error} retry={() => void pages.refetch()} />}
      {thread.isSuccess && pages.isSuccess && empty && (
        <WorkspaceAttachments.Empty>{t('NoteOutlineEmpty')}</WorkspaceAttachments.Empty>
      )}
      <OutlineNavigation thread={thread} pages={pages} />
    </WorkspaceAttachments.OutlineFeedback>
  );
}

function OutlineNavigation({
  thread,
  pages
}: {
  thread: ReturnType<typeof useThreadPage>;
  pages: ReturnType<typeof useLinkedPages>;
}) {
  const { t } = useI18n();

  return (
    <>
      {thread.pagination.hasPrevious && (
        <Button
          variant="ghost-muted"
          size="sm"
          disabled={thread.isFetching}
          onClick={thread.pagination.previous}
        >
          {t('LibraryPrevious')}
        </Button>
      )}
      {thread.hasNextPage && (
        <Button
          variant="ghost-muted"
          size="sm"
          disabled={thread.isFetchingNextPage}
          onClick={() => void thread.fetchNextPage()}
        >
          {t('NoteEarlier')}
        </Button>
      )}
      <CursorWindowActions
        hasPrevious={pages.pagination.hasPrevious}
        previous={pages.pagination.previous}
        hasMore={pages.data?.nextCursor != null}
        more={() => pages.pagination.more(pages.data?.nextCursor)}
        pending={pages.isFetching}
      />
    </>
  );
}
