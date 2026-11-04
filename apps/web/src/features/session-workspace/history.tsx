import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { SessionId, VersionId, SourceId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ChatConversation, ChatMessage, ChatMessageText } from '@study/ui/chat';
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
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { History as HistoryIcon } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { CapturedInputLink } from '../source-library';
import { AttachmentCards } from './attachment-cards';
import { ItemContextMenu } from './item-context-menu';
import { ItemDeletionMenu } from './item-deletion-menu';
import type { ItemDeletionActions } from './item-deletion-menu';
import { MessageActions } from './message-actions';
import { MessageDeletion } from './message-deletion';
import { NoteContent, NoteSummary } from './note-editor';
import { notebookMessages, notebookTargetId, notebookTimeline } from './notebook-index';
import { NotebookNavigation } from './notebook-navigation';
import { PendingMessageWork } from './pending-message-work';
import { SessionDocumentCard } from './session-document-card';
import { citationsOptions, threadOptions } from './session-workspace.queries';
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
      target={<button type="button" onClick={() => onOpen(message)} />}
      dialogOpen={actions?.open}
      actions={actions && <ItemDeletionMenu {...actions} />}
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
  return version ? (
    <MessageDeletion message={message} versionId={version.id} renderActions={menu} />
  ) : (
    menu()
  );
}

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

  return (
    <ChatMessage>
      {!version && <p role="status">{t('SessionReadUnavailable')}</p>}
      {version && (
        <>
          <MessageActions
            message={message}
            versionId={version.id}
            onActive={() => setSelected(undefined)}
            onVersionChange={setSelected}
          >
            {message.format === 'document' || message.role === 'assistant' ? (
              <NoteContent value={version.text} />
            ) : (
              <ChatMessageText text={version.text} />
            )}
          </MessageActions>
          {version.status !== 'complete' && (
            <PendingMessageWork
              sessionId={message.sessionId}
              messageId={message.id}
              versionId={version.id}
            />
          )}
        </>
      )}
      {message.parts.length > 0 && (
        <AttachmentCards
          parts={message.parts}
          onOpenSource={onOpenSource}
          indexSessionId={indexAnchors ? message.sessionId : undefined}
        />
      )}
      <MessageCitations message={message} versionId={version?.id} />
    </ChatMessage>
  );
}

function MessageCitations({ message, versionId }: { message: Message; versionId?: VersionId }) {
  const { t } = useI18n();
  const citations = useQuery({
    ...citationsOptions(message.sessionId, message.id, versionId),
    enabled: !!versionId
  });

  return (
    <>
      {citations.error && (
        <SessionReadError error={citations.error} retry={() => void citations.refetch()} />
      )}
      {!!citations.data?.citations.length && (
        <details>
          <summary>{t('SessionCitations')}</summary>
          <ol>
            {citations.data.citations.map((citation) => (
              <li key={`${citation.marker}:${citation.quote}`}>
                <p>
                  {citation.input ? (
                    <CapturedInputLink input={citation.input} name={citation.sourceName} />
                  ) : (
                    citation.sourceName
                  )}{' '}
                  · {citation.marker}
                </p>
                <blockquote>{citation.quote}</blockquote>
                <Notebook.Muted>
                  {t(
                    citation.precision === 'exact'
                      ? 'SessionExactEvidence'
                      : citation.precision === 'approximate'
                        ? 'SessionApproximateEvidence'
                        : 'SessionEvidenceUnavailable'
                  )}
                </Notebook.Muted>
              </li>
            ))}
          </ol>
        </details>
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
