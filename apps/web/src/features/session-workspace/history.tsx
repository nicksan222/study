import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { SessionId, VersionId, SourceId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ChatConversation, ChatMessage, ChatEntryLabel } from '@study/ui/chat';
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose
} from '@study/ui/dialog';
import { Loading } from '@study/ui/loading';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { Notebook } from '@study/ui/session-workspace';
import { WorkspaceSurface } from '@study/ui/workspace';
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
import { notebookMessages, notebookTargetId, notebookTimeline } from './notebook-index';
import { NotebookNavigation } from './notebook-navigation';
import { PendingMessageWork } from './pending-message-work';
import { QuestionActions } from './question-actions';
import { SessionDocumentCard } from './session-document-card';
import { threadOptions } from './session-workspace.queries';
import { SessionReadError } from './status';

export { CapturedContext } from './captured-context';

type Message = typeof chatMessageSchema.Type;

export function History({
  id,
  onDocument,
  onOpen,
  activeDocument,
  documents = [],
  onOpenDocument,
  onOpenSource,
  activeAuthoredDocument
}: {
  id: SessionId;
  onDocument?: () => void;
  onOpen?: (message: Message) => void;
  activeDocument?: string;
  documents?: readonly StudyDocumentSummary[];
  onOpenDocument?: (material: StudyDocumentSummary) => void;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
  activeAuthoredDocument?: string;
}) {
  const { t } = useI18n();
  const state = useInfiniteQuery(threadOptions(id));
  const messages = notebookMessages(id, state.data?.pages.flatMap((page) => page.items) ?? []);
  const entries = notebookTimeline(messages, documents);

  return (
    <ChatConversation
      key={String(id)}
      label={t('SessionNotebook')}
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
      <Notebook.History aria-label={t('SessionNotebook')}>
        <Notebook.NotesHeading>
          <Notebook.PageHeading>
            <h1>{t('SessionNotesTitle')}</h1>
            <p>{t('SessionNotesHelp')}</p>
          </Notebook.PageHeading>
          {onDocument && (
            <Button variant="outline" size="sm" onClick={onDocument}>
              {t('SessionWritePage')}
            </Button>
          )}
        </Notebook.NotesHeading>
        {state.isPending && <Loading label={t('LoadingStudy')} />}
        {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
        {state.hasNextPage && (
          <Button
            variant="ghost"
            disabled={state.isFetchingNextPage}
            onClick={() => void state.fetchNextPage()}
          >
            {t('SessionEarlier')}
          </Button>
        )}
        {state.isSuccess && messages.length === 0 && documents.length === 0 && (
          <WorkspaceSurface.Heading>
            <h3>{t('SessionNotesEmpty')}</h3>
            <p>{t('SessionStartHelp')}</p>
          </WorkspaceSurface.Heading>
        )}
        {entries.map((entry) => (
          <Notebook.IndexTarget
            key={timelineKey(entry)}
            id={notebookTargetId(
              id,
              entry.kind,
              entry.kind === 'document' ? entry.document.id : entry.message.id
            )}
            tabIndex={-1}
          >
            {entry.kind === 'document' ? (
              <SessionDocumentCard
                sessionId={id}
                document={entry.document}
                onOpen={(material) => onOpenDocument?.(material)}
                active={String(entry.document.id) === activeAuthoredDocument}
              />
            ) : (
              <HistoryMessage
                message={entry.message}
                onOpen={onOpen}
                activeDocument={activeDocument}
                onOpenSource={onOpenSource}
                indexAnchors
              />
            )}
          </Notebook.IndexTarget>
        ))}
      </Notebook.History>
    </ChatConversation>
  );
}

function timelineKey(entry: ReturnType<typeof notebookTimeline>[number] | undefined) {
  if (!entry) return undefined;

  return entry.kind === 'message'
    ? 'message-' + String(entry.message.id)
    : 'material-' + String(entry.document.id);
}

function HistoryMessage({
  message,
  onOpen,
  activeDocument,
  onOpenSource,
  indexAnchors
}: {
  message: Message;
  onOpen?: (message: Message) => void;
  activeDocument?: string;
  indexAnchors?: boolean;
  onOpenSource?: (source: { id: SourceId; name: string }) => void;
}) {
  return message.format === 'document' && onOpen ? (
    <DocumentEntry
      message={message}
      onOpen={onOpen}
      active={(message.captureKey ?? String(message.id)) === activeDocument}
    />
  ) : (
    <MessageEntry message={message} onOpenSource={onOpenSource} indexAnchors={indexAnchors} />
  );
}

function DocumentEntry({
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
      label={t('SessionOpenPage')}
      target={
        <button type="button" aria-label={t('SessionOpenPage')} onClick={() => onOpen(message)} />
      }
      dialogOpen={actions?.open}
      actions={
        <>
          <ArchiveMenuItem
            sessionId={message.sessionId}
            target={{ kind: 'message', id: message.id }}
          />
          {actions && <ItemDeletionMenu {...actions} />}
        </>
      }
    >
      <Desk.DocumentCard
        title={<NoteSummary value={version?.text ?? ''} fallback={t('SessionNewPage')} />}
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
      <ChatEntryLabel>{t('SessionEntryDocument')}</ChatEntryLabel>
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
      {!version && <p role="status">{t('SessionReadUnavailable')}</p>}
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
          sessionId={message.sessionId}
          parts={message.parts}
          onOpenSource={onOpenSource}
          indexSessionId={indexAnchors ? message.sessionId : undefined}
        />
      )}
      <MessageSources key={String(version?.id)} citations={citations.items} />
      {citations.error && (
        <SessionReadError error={citations.error} retry={() => void citations.refetch()} />
      )}
    </ChatMessage>
  );
}

function messageEntryLabel(message: Message, version: Message['versions'][number] | undefined) {
  if (message.format === 'document') return 'SessionEntryDocument';

  if (isQuestionVersion(message, version?.id)) return 'SessionQuestion';

  if (message.role === 'assistant' || version?.origin === 'answer') return 'SessionAnswer';

  if (!version?.text.trim() && message.parts.length > 0) return 'SessionEntryAttachment';

  return 'SessionEntryNote';
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
            <MessageContent message={message} version={version} citations={citations} />
          </MessageActions>
        )}
      </QuestionActions>
      {version.status !== 'complete' && (
        <PendingMessageWork
          sessionId={message.sessionId}
          messageId={message.id}
          versionId={version.id}
        />
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
        <DialogHeader>
          <DialogTitle>{t('VersionHistory')}</DialogTitle>
        </DialogHeader>
        <WorkspaceSurface.ContextDialogBody>
          <WorkspaceSurface.Container>
            <MessageEntry message={message} />
          </WorkspaceSurface.Container>
        </WorkspaceSurface.ContextDialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('Close')}</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
