import type { NoteId, VersionId, SourceId } from '@study/contracts/ids';
import type { chatMessageSchema } from '@study/contracts/notes/schemas';
import type { PageSummary } from '@study/contracts/pages/types';
import { Button } from '@study/ui/button';
import { ChatNote, ChatMessage, ChatEntryLabel } from '@study/ui/chat';
import { Dialog, DialogTrigger, DialogPopup, DialogFooter } from '@study/ui/dialog';
import { DialogDismissButton } from '@study/ui/dialog-form-actions';
import { DialogHeading } from '@study/ui/dialog-heading';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/note-workspace';
import { StatusMessage } from '@study/ui/status-message';
import { WorkspaceSurface } from '@study/ui/workspace';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { useInfiniteQuery } from '@tanstack/react-query';
import { History as HistoryIcon } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { ArchiveMenuItem } from './archive-menu-item';
import { AttachmentCards } from './attachment-cards';
import { ItemContextMenu } from './item-context-menu';
import { ItemDeletionMenu } from './item-deletion-menu';
import type { ItemDeletionActions } from './item-deletion-menu';
import { MessageActions } from './message-actions';
import { MessageContent, MessageSources, useMessageCitations } from './message-citations';
import type { MessageCitation } from './message-citations';
import { MessageDeletion } from './message-deletion';
import { NoteSummary } from './note-editor';
import { NotePageCard } from './note-page-card';
import { threadOptions } from './note-workspace.queries';
import { notebookMessages, notebookTargetId, notebookTimeline } from './notebook-index';
import { NotebookNavigation } from './notebook-navigation';
import { PendingMessageWork } from './pending-message-work';
import { QuestionActions } from './question-actions';
import { NoteReadError } from './status';

export { CapturedContext } from './captured-context';

type Message = typeof chatMessageSchema.Type;

export function History({
  id,
  onPage,
  onOpen,
  activePage,
  pages = [],
  onOpenPage,
  onOpenSource,
  activeAuthoredPage
}: {
  id: NoteId;
  onPage?: () => void;
  onOpen?: (message: Message) => void;
  activePage?: string;
  pages?: readonly PageSummary[];
  onOpenPage?: (material: PageSummary) => void;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
  activeAuthoredPage?: string;
}) {
  const { t } = useI18n();
  const state = useInfiniteQuery(threadOptions(id));
  const messages = notebookMessages(id, state.data?.pages.flatMap((page) => page.items) ?? []);
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
        <Notebook.NotesHeading>
          <Notebook.PageHeading>
            <h1>{t('NoteNotesTitle')}</h1>
            <p>{t('NoteNotesHelp')}</p>
          </Notebook.PageHeading>
          {onPage && (
            <Button variant="outline" size="sm" onClick={onPage}>
              {t('NoteWritePage')}
            </Button>
          )}
        </Notebook.NotesHeading>
        {state.isPending && <Loading label={t('LoadingStudy')} />}
        {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
        {state.hasNextPage && (
          <Button
            variant="ghost"
            disabled={state.isFetchingNextPage}
            onClick={() => void state.fetchNextPage()}
          >
            {t('NoteEarlier')}
          </Button>
        )}
        {state.isSuccess && messages.length === 0 && pages.length === 0 && (
          <WorkspaceSurface.Heading>
            <h3>{t('NoteNotesEmpty')}</h3>
            <p>{t('NoteStartHelp')}</p>
          </WorkspaceSurface.Heading>
        )}
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
              <HistoryMessage
                message={entry.message}
                onOpen={onOpen}
                activePage={activePage}
                onOpenSource={onOpenSource}
                indexAnchors
              />
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
  activePage,
  onOpenSource,
  indexAnchors
}: {
  message: Message;
  onOpen?: (message: Message) => void;
  activePage?: string;
  indexAnchors?: boolean;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
}) {
  return message.format === 'document' && onOpen ? (
    <PageEntry
      message={message}
      onOpen={onOpen}
      active={(message.captureKey ?? String(message.id)) === activePage}
    />
  ) : (
    <MessageEntry message={message} onOpenSource={onOpenSource} indexAnchors={indexAnchors} />
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

/** Renders the selected note version while preserving attachments, citations and pending work. */
function MessageEntry({
  message,
  onOpenSource,
  indexAnchors
}: {
  message: Message;
  indexAnchors?: boolean;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<VersionId>();
  const version =
    message.versions.find((item) => item.id === selected) ??
    message.versions.find((item) => item.id === message.activeVersionId);
  const citations = useMessageCitations(message, version?.id);

  return (
    <ChatMessage data-role={message.role}>
      <ChatEntryLabel>{t(messageEntryLabel(message, version))}</ChatEntryLabel>
      {!version && <StatusMessage>{t('NoteReadUnavailable')}</StatusMessage>}
      {version && (
        <MessageVersionBody
          message={message}
          version={version}
          onActive={() => setSelected(undefined)}
          onVersionChange={setSelected}
          citations={citations.items}
        />
      )}
      {message.parts.length > 0 && (
        <AttachmentCards
          noteId={message.noteId}
          parts={message.parts}
          onOpenSource={onOpenSource}
          indexNoteId={indexAnchors ? message.noteId : undefined}
        />
      )}
      <MessageSources key={String(version?.id)} citations={citations.items} />
      {citations.error && (
        <NoteReadError error={citations.error} retry={() => void citations.refetch()} />
      )}
    </ChatMessage>
  );
}

function messageEntryLabel(message: Message, version: Message['versions'][number] | undefined) {
  if (message.format === 'document') return 'NoteEntryPage';

  if (isQuestionVersion(message, version?.id)) return 'NoteQuestion';

  if (message.role === 'assistant' || version?.origin === 'answer') return 'NoteAnswer';

  if (!version?.text.trim() && message.parts.length > 0) return 'NoteEntryAttachment';

  return 'NoteEntryNote';
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
  onActive,
  onVersionChange,
  citations
}: {
  message: Message;
  version: Message['versions'][number];
  onActive: () => void;
  onVersionChange: (id: VersionId) => void;
  citations: readonly MessageCitation[];
}) {
  const contentVersion =
    version.status !== 'complete' && !version.text
      ? (message.versions.find((item) => item.id === version.basedOn) ?? version)
      : version;

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
