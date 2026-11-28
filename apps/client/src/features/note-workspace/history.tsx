import type { NoteId, VersionId, chatMessageSchema, PageSummary } from '@study/contracts';
import { HistoryIcon } from '@study/icons';
import {
  Button,
  ChatNote,
  ChatMessage,
  ChatEntryLabel,
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogFooter,
  DialogDismissButton,
  DialogHeading,
  Loading,
  Notebook,
  StatusMessage,
  WorkspaceSurface,
  WorkspaceDeskSurface as Desk
} from '@study/ui';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { ArchiveMenuItem } from './archive-menu-item';
import { ItemContextMenu } from './item-context-menu';
import { ItemDeletionMenu } from './item-deletion-menu';
import type { ItemDeletionActions } from './item-deletion-menu';
import { MessageActions } from './message-actions';
import { MessageContent, MessageSources, useMessageCitations } from './message-citations';
import type { MessageCitation } from './message-citations';
import { MessageDeletion } from './message-deletion';
import { NoteSummary } from './note-editor';
import { NotePageCard } from './note-page-card';
import { useThreadPage } from './note-reads';
import { NotebookHeading } from './notebook-heading';
import { notebookMessages, notebookTargetId, notebookTimeline } from './notebook-index';
import { NotebookNavigation } from './notebook-navigation';
import { PendingMessageWork } from './pending-message-work';
import { QuestionActions } from './question-actions';
import { messageSectionTitle } from './section-title';
import { NoteReadError } from './status';

type Message = typeof chatMessageSchema.Type;

type HistoryProps = {
  id: NoteId;
  onOpen?: (message: Message) => void;
  activePage?: string;
  pages?: readonly PageSummary[];
  onOpenPage?: (material: PageSummary) => void;
  activeAuthoredPage?: string;
};

type ThreadState = ReturnType<typeof useThreadPage>;

/** A supplied window keeps the notebook and its context outline on the same loaded entries. */
export function History({ state, ...props }: HistoryProps & { state?: ThreadState }) {
  return state ? <HistoryContent {...props} state={state} /> : <HistoryRead {...props} />;
}

function HistoryRead(props: HistoryProps) {
  const state = useThreadPage(props.id);

  return <HistoryContent {...props} state={state} />;
}

function HistoryContent({
  id,
  onOpen,
  activePage,
  pages = [],
  onOpenPage,
  activeAuthoredPage,
  state
}: HistoryProps & { state: ThreadState }) {
  const { t } = useI18n();
  const messages = notebookMessages(id, state.data?.items ?? []);
  const entries = notebookTimeline(messages, pages);

  return (
    <ChatNote
      key={String(id)}
      label={t('NoteNotebook')}
      jumpLabel={t('JumpToLatest')}
      itemCount={entries.length}
      firstItemKey={timelineKey(entries[0])}
      navigation={
        <NotebookNavigation
          id={id}
          entries={entries}
          more={!!state.hasNextPage}
          pending={state.isFetchingNextPage}
          onMore={() => void state.fetchNextPage()}
        />
      }
    >
      <Notebook.History aria-label={t('NoteNotebook')}>
        <NotebookHeading />
        <NotebookHistoryFeedback
          state={state}
          messageCount={messages.length}
          pageCount={pages.length}
        />
        {entries.map((entry) => (
          <Notebook.IndexTarget
            key={timelineKey(entry)}
            id={notebookTargetId(
              id,
              entry.kind,
              entry.kind === 'page' ? entry.page.id : entry.message.id
            )}
            tabIndex={-1}
          >
            {entry.kind === 'page' ? (
              <NotePageCard
                noteId={id}
                page={entry.page}
                onOpen={(material) => onOpenPage?.(material)}
                active={String(entry.page.id) === activeAuthoredPage}
              />
            ) : (
              <HistoryMessage message={entry.message} onOpen={onOpen} activePage={activePage} />
            )}
          </Notebook.IndexTarget>
        ))}
      </Notebook.History>
    </ChatNote>
  );
}

function timelineKey(entry: ReturnType<typeof notebookTimeline>[number] | undefined) {
  if (!entry) return undefined;

  return entry.kind === 'message'
    ? 'message-' + String(entry.message.id)
    : 'material-' + String(entry.page.id);
}

function HistoryMessage({
  message,
  onOpen,
  activePage
}: {
  message: Message;
  onOpen?: (message: Message) => void;
  activePage?: string;
}) {
  return message.format === 'document' && onOpen ? (
    <PageEntry
      message={message}
      onOpen={onOpen}
      active={(message.captureKey ?? String(message.id)) === activePage}
    />
  ) : (
    <MessageEntry message={message} />
  );
}

function PageEntry({
  message,
  onOpen,
  active
}: {
  message: Message;
  onOpen: (message: Message) => void;
  active: boolean;
}) {
  const { t } = useI18n();
  const version = message.versions.find((item) => item.id === message.activeVersionId);

  const menu = (actions?: ItemDeletionActions) => (
    <ItemContextMenu
      label={t('NoteOpenPage')}
      target={
        <button type="button" aria-label={t('NoteOpenPage')} onClick={() => onOpen(message)} />
      }
      dialogOpen={actions?.open}
      actions={
        <>
          <ArchiveMenuItem noteId={message.noteId} target={{ kind: 'message', id: message.id }} />
          {actions && <ItemDeletionMenu {...actions} />}
        </>
      }
    >
      <Desk.PageCard
        title={<NoteSummary value={version?.text ?? ''} fallback={t('NoteNewPage')} />}
        preview={
          message.description || (
            <NoteSummary value={version?.text.split('\n').slice(1).join('\n') ?? ''} fallback="" />
          )
        }
        onOpen={() => onOpen(message)}
        active={active}
      />
    </ItemContextMenu>
  );

  return (
    <>
      <ChatEntryLabel>{t('NoteEntryPage')}</ChatEntryLabel>
      {version ? (
        <MessageDeletion message={message} versionId={version.id} renderActions={menu} />
      ) : (
        menu()
      )}
    </>
  );
}

/** Renders the selected note version and its historical evidence. */
function MessageEntry({ message }: { message: Message }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<VersionId>();
  const version =
    message.versions.find((item) => item.id === selected) ??
    message.versions.find((item) => item.id === message.activeVersionId);
  const contentVersion = messageContentVersion(message, version);
  const citations = useMessageCitations(message, contentVersion?.id);

  return (
    <ChatMessage data-role={message.role}>
      <SectionHeading message={message} version={contentVersion} />
      <MessageEntryLabel message={message} version={version} />
      {!version && <StatusMessage>{t('NoteReadUnavailable')}</StatusMessage>}
      {version && (
        <MessageVersionBody
          message={message}
          version={version}
          contentVersion={contentVersion ?? version}
          onActive={() => setSelected(undefined)}
          onVersionChange={setSelected}
          citations={citations.items}
        />
      )}
      <MessageSources key={String(contentVersion?.id)} citations={citations.items} />
      {citations.error && (
        <NoteReadError error={citations.error} retry={() => void citations.refetch()} />
      )}
    </ChatMessage>
  );
}

function SectionHeading({
  message,
  version
}: {
  message: Message;
  version: Message['versions'][number] | undefined;
}) {
  const title = version ? messageSectionTitle(message, version.id) : undefined;

  return title ? <Notebook.SectionTitle>{title}</Notebook.SectionTitle> : null;
}

/** Keep displayed content and evidence bound to the same immutable version. */
function messageContentVersion(message: Message, version: Message['versions'][number] | undefined) {
  if (!version || version.status === 'complete' || version.text) return version;

  return message.versions.find((item) => item.id === version.basedOn) ?? version;
}

function messageEntryLabel(message: Message, version: Message['versions'][number] | undefined) {
  if (message.format === 'document') return 'NoteEntryPage';

  if (isQuestionVersion(message, version?.id)) return 'NoteQuestion';

  if (message.role === 'assistant' || version?.origin === 'answer') return 'NoteAnswer';

  return 'NoteEntryNote';
}

function MessageEntryLabel({
  message,
  version
}: {
  message: Message;
  version: Message['versions'][number] | undefined;
}) {
  const { t } = useI18n();
  const label = messageEntryLabel(message, version);

  return label === 'NoteEntryNote' ? null : <ChatEntryLabel>{t(label)}</ChatEntryLabel>;
}

function isQuestionVersion(message: Message, versionId: VersionId | undefined) {
  return (
    message.question?.kind === 'question' &&
    (message.question.versionId === versionId || message.question.answerVersionId === versionId)
  );
}

/** Keeps content, question controls and pending work attached to the displayed version. */
function MessageVersionBody({
  message,
  version,
  contentVersion,
  onActive,
  onVersionChange,
  citations
}: {
  message: Message;
  version: Message['versions'][number];
  contentVersion: Message['versions'][number];
  onActive: () => void;
  onVersionChange: (id: VersionId) => void;
  citations: readonly MessageCitation[];
}) {
  return (
    <>
      <QuestionActions message={message} versionId={version.id}>
        {(questionAction) => (
          <MessageActions
            message={message}
            versionId={version.id}
            onActive={onActive}
            onVersionChange={onVersionChange}
            questionAction={questionAction}
          >
            <MessageContent message={message} version={contentVersion} citations={citations} />
          </MessageActions>
        )}
      </QuestionActions>
      {version.status !== 'complete' && (
        <PendingMessageWork noteId={message.noteId} messageId={message.id} versionId={version.id} />
      )}
    </>
  );
}

/** Keeps immutable versions, evidence and existing note actions reachable from the document editor. */

export function PageDetails({ message }: { message: Message }) {
  const { t } = useI18n();

  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="ghost-muted" size="icon-sm" />}
        aria-label={t('VersionHistory')}
        title={t('VersionHistory')}
      >
        <HistoryIcon size={15} aria-hidden="true" />
      </DialogTrigger>
      <DialogPopup closeLabel={t('Close')} variant="workspace-context" bottomStickOnMobile={false}>
        <DialogHeading title={<> {t('VersionHistory')} </>} />
        <WorkspaceSurface.ContextDialogBody>
          <WorkspaceSurface.Container>
            <MessageEntry message={message} />
          </WorkspaceSurface.Container>
        </WorkspaceSurface.ContextDialogBody>
        <DialogFooter>
          <DialogDismissButton label={t('Close')} />
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function NotebookHistoryFeedback({
  state,
  messageCount,
  pageCount
}: {
  state: ReturnType<typeof useThreadPage>;
  messageCount: number;
  pageCount: number;
}) {
  const { t } = useI18n();

  return (
    <>
      {' '}
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
      {state.pagination.hasPrevious && (
        <Button variant="ghost" disabled={state.isFetching} onClick={state.pagination.previous}>
          {t('LibraryPrevious')}
        </Button>
      )}
      {state.hasNextPage && (
        <Button
          variant="ghost"
          disabled={state.isFetchingNextPage}
          onClick={() => void state.fetchNextPage()}
        >
          {t('NoteEarlier')}
        </Button>
      )}
      {state.isSuccess && messageCount === 0 && pageCount === 0 && (
        <WorkspaceSurface.Heading>
          <h3>{t('NoteNotesEmpty')}</h3>
          <p>{t('NoteStartHelp')}</p>
        </WorkspaceSurface.Heading>
      )}
    </>
  );
}
