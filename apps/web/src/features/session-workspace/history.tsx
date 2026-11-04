import { selectionReferenceKey } from '@study/contracts/conversations/context';
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
import { Link } from '@tanstack/react-router';
import { History as HistoryIcon } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { CapturedInputLink } from '../source-library/input-link';
import { AttachmentCards } from './attachment-cards';
import { MessageActions } from './message-actions';
import { NoteContent, NoteSummary } from './note-editor';
import { notebookMessages, notebookTargetId, notebookTimeline } from './notebook-index';
import { NotebookNavigation } from './notebook-navigation';
import { SessionDocumentCard } from './session-document-card';
import {
  citationsOptions,
  contextOptions,
  provenanceOptions,
  threadOptions
} from './session-workspace.queries';
import { ExecutionStatus, SessionReadError } from './status';

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

  return (
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
  const version = message.versions.find(
    (item) => item.id === (selected ?? message.activeVersionId)
  );

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
          {version.status !== 'complete' && <Loading label={t('SessionPending')} />}
          {hasReplyContext(message, version.origin) && (
            <ReplyContext
              sessionId={message.sessionId}
              message={message}
              versionId={version.id}
              pending={version.status !== 'complete'}
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

function ReplyContext({
  sessionId,
  message,
  versionId,
  pending
}: {
  sessionId: SessionId;
  message: Message;
  versionId: VersionId;
  pending: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const provenance = useQuery({
    ...provenanceOptions(sessionId, message.id, versionId),
    enabled: open || pending
  });
  const receipt = provenance.isError ? undefined : provenance.data;
  const available = receipt?.state === 'available' ? receipt.requestId : undefined;

  return (
    <>
      {available ? (
        pending ? (
          <>
            <Loading label={t('SessionPending')} />
            <ExecutionStatus requestId={available} />
          </>
        ) : null
      ) : null}
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>{t('SessionContextUsed')}</summary>
        <ProvenanceFeedback provenance={provenance} open={open} />
        {open && available && <CapturedContext requestId={available} />}
      </details>
    </>
  );
}

export function CapturedContext({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const state = useQuery(contextOptions(requestId));

  return (
    <Notebook.Captured>
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {state.data && !state.isError && (
        <>
          <Notebook.Muted>
            {t('SessionCapturedHelp')} · {t('SessionRevision')}{' '}
            {String(state.data.selectionRevision)}
          </Notebook.Muted>
          {state.data.instruction && (
            <Notebook.Instruction>{state.data.instruction}</Notebook.Instruction>
          )}
          <ul>
            {state.data.inputs.map((input) => (
              <li key={selectionReferenceKey(input.input)}>
                <CapturedInputLink input={input.input} name={input.name} /> · {t('ReaderVersion')}{' '}
                {input.input.kind === 'document'
                  ? String(input.input.versionId)
                  : String(input.input.revision)}{' '}
                ·{' '}
                {t(
                  input.scope.kind === 'document'
                    ? 'SessionWhole'
                    : input.scope.kind === 'blocks'
                      ? 'SessionBlocks'
                      : 'SessionRanges'
                )}
                {input.excerpts.map((excerpt) => (
                  <blockquote key={`${excerpt.blockId}-${excerpt.start}-${excerpt.end}`}>
                    <p>{excerpt.text}</p>
                    <small>
                      {excerpt.blockId} · {excerpt.start}–{excerpt.end}
                    </small>
                  </blockquote>
                ))}
              </li>
            ))}
          </ul>
          <details>
            <summary>
              {t('SessionCapturedNotes')} · {state.data.messages.length}
            </summary>
            {state.data.messages.map((message) => (
              <Notebook.Prose key={`${message.messageId}-${message.versionId}`}>
                {message.text}
              </Notebook.Prose>
            ))}
          </details>
          {state.data.excludedMessages > 0 && (
            <p>
              {t('SessionExcludedNotes')} {state.data.excludedMessages}
            </p>
          )}
        </>
      )}
    </Notebook.Captured>
  );
}

function ProvenanceNotice({ state }: { state: string | undefined }) {
  const { t } = useI18n();

  if (state === 'manual') return <p>{t('SessionManualVersion')}</p>;

  if (state === 'retired' || state === 'unavailable')
    return <p>{t('SessionContextUnavailable')}</p>;

  return null;
}

function hasReplyContext(message: Message, origin: string) {
  return message.role === 'assistant' || (origin !== 'typed' && origin !== 'edited');
}

function ProvenanceFeedback({
  provenance,
  open
}: {
  provenance: ReturnType<
    typeof useQuery<
      Awaited<
        ReturnType<Exclude<ReturnType<typeof provenanceOptions>['queryFn'], undefined | symbol>>
      >
    >
  >;
  open: boolean;
}) {
  const { t } = useI18n();
  const receipt = provenance.isError ? undefined : provenance.data;

  return (
    <>
      {open ? provenance.isPending ? <Loading label={t('LoadingStudy')} /> : null : null}
      {provenance.error && (
        <SessionReadError error={provenance.error} retry={() => void provenance.refetch()} />
      )}
      <ProvenanceNotice state={receipt?.state} />
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
