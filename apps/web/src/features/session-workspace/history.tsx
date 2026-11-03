import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import type { SessionId, VersionId, MaterialVersionId } from '@study/contracts/ids';
import type { MaterialSummaryDto } from '@study/contracts/materials/schemas';
import { Button } from '@study/ui/button';
import { ChatConversation, ChatMessage, ChatMessageText, ChatTimelineEvent } from '@study/ui/chat';
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

import { useI18n } from '../../lib/i18n';
import { versionOptions } from '../material-library';
import { AttachmentCards } from './attachment-cards';
import { MessageActions } from './message-actions';
import { NoteContent, NoteSummary } from './note-editor';
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
  onOpenMaterial,
  activeMaterial
}: {
  id: SessionId;
  onDocument?: () => void;
  onOpen?: (message: Message) => void;
  activeDocument?: string;
  documents?: readonly MaterialSummaryDto[];
  onOpenMaterial?: (material: MaterialSummaryDto) => void;
  activeMaterial?: string;
}) {
  const { t, date } = useI18n();
  const state = useInfiniteQuery(threadOptions(id));
  const messages = [
    ...new Map(
      state.data?.pages.flatMap((page) => page.items).map((message) => [message.id, message])
    ).values()
  ].toSorted((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1
  );

  const entries = timelineEntries(messages, documents);

  return (
    <ChatConversation
      key={String(id)}
      label={t('SessionNotebook')}
      jumpLabel={t('JumpToLatest')}
      itemCount={entries.length}
      firstItemKey={timelineKey(entries[0])}
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
          <ChatTimelineEvent key={timelineKey(entry)} time={date(entry.time)}>
            {entry.kind === 'document' ? (
              <SessionDocumentCard
                material={entry.material}
                onOpen={(material) => onOpenMaterial?.(material)}
                active={String(entry.material.id) === activeMaterial}
              />
            ) : (
              <HistoryMessage
                message={entry.message}
                onOpen={onOpen}
                activeDocument={activeDocument}
                onOpenMaterial={onOpenMaterial}
              />
            )}
          </ChatTimelineEvent>
        ))}
      </Notebook.History>
    </ChatConversation>
  );
}

function timelineKey(entry: ReturnType<typeof timelineEntries>[number] | undefined) {
  if (!entry) return undefined;

  return entry.kind === 'message'
    ? 'message-' + String(entry.message.id)
    : 'material-' + String(entry.material.id);
}

function timelineEntries(messages: Message[], documents: readonly MaterialSummaryDto[]) {
  const entries = [
    ...messages.map((message) => ({ kind: 'message' as const, message, time: message.createdAt })),
    ...documents.map((material) => ({
      kind: 'document' as const,
      material,
      time: material.created_at
    }))
  ];

  return entries.toSorted((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

function HistoryMessage({
  message,
  onOpen,
  activeDocument,
  onOpenMaterial
}: {
  message: Message;
  onOpen?: (message: Message) => void;
  activeDocument?: string;
  onOpenMaterial?: (material: MaterialSummaryDto) => void;
}) {
  return message.format === 'document' && onOpen ? (
    <DocumentEntry
      message={message}
      onOpen={onOpen}
      active={(message.captureKey ?? String(message.id)) === activeDocument}
    />
  ) : (
    <MessageEntry message={message} onOpenMaterial={onOpenMaterial} />
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
  const { t, date } = useI18n();
  const version = message.versions.find((item) => item.id === message.activeVersionId);

  return (
    <Desk.DocumentCard
      title={<NoteSummary value={version?.text ?? ''} fallback={t('SessionNewPage')} />}
      preview={
        message.description || (
          <NoteSummary value={version?.text.split('\n').slice(1).join('\n') ?? ''} fallback="" />
        )
      }
      meta={date(message.createdAt)}
      onOpen={() => onOpen(message)}
      active={active}
    />
  );
}

function MessageEntry({
  message,
  onOpenMaterial
}: {
  message: Message;
  onOpenMaterial?: (material: MaterialSummaryDto) => void;
}) {
  const { t, date } = useI18n();
  const [selected, setSelected] = useState<VersionId>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const version = message.versions.find(
    (item) => item.id === (selected ?? message.activeVersionId)
  );

  return (
    <ChatMessage>
      <header>
        <time>{date(message.createdAt)}</time>
      </header>
      {!version && <p role="status">{t('SessionReadUnavailable')}</p>}
      {version && (
        <>
          <MessageActions
            message={message}
            versionId={version.id}
            onActive={() => setSelected(undefined)}
          >
            <MessageContent message={message} text={version.text} />
          </MessageActions>
          {version.status !== 'complete' && <Loading label={t('SessionPending')} />}
          <MessageVersions
            message={message}
            versionId={version.id}
            open={historyOpen}
            setOpen={setHistoryOpen}
            select={setSelected}
          />
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
        <AttachmentCards parts={message.parts} onOpenDocument={onOpenMaterial} />
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
              <li key={`${citation.marker}:${citation.materialVersionId}:${citation.quote}`}>
                <p>
                  {citation.materialVersionId ? (
                    <CitationLink
                      versionId={citation.materialVersionId}
                      name={citation.sourceName}
                    />
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

function MessageContent({ message, text }: { message: Message; text: string }) {
  return message.role === 'user' && message.format !== 'document' ? (
    <ChatMessageText text={text} />
  ) : (
    <NoteContent value={text} />
  );
}

function CitationLink({ versionId, name }: { versionId: MaterialVersionId; name: string }) {
  const state = useQuery(versionOptions(versionId));

  return state.data ? (
    <Link
      to="/materials/$materialId"
      params={{ materialId: String(state.data.material_id) }}
      search={{ version: String(versionId) }}
    >
      {name}
    </Link>
  ) : (
    <span>{name}</span>
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
              <li
                key={JSON.stringify(
                  { versionId: String(input.versionId), scope: input.scope },
                  (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value)
                )}
              >
                <Link
                  to="/materials/$materialId"
                  params={{ materialId: String(input.materialId) }}
                  search={{ version: String(input.versionId) }}
                >
                  {input.name}
                </Link>{' '}
                · {t('ReaderVersion')} {String(input.versionId)} ·{' '}
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

function MessageVersions({
  message,
  versionId,
  open,
  setOpen,
  select
}: {
  message: Message;
  versionId: VersionId;
  open: boolean;
  setOpen: (open: boolean) => void;
  select: (id: VersionId) => void;
}) {
  const { t, date } = useI18n();

  return (
    <>
      {message.versions.length > 1 && (
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary>{t('SessionVersions')}</summary>
          <Notebook.Actions
            role="group"
            aria-label={`${t('SessionNote')} · ${date(message.createdAt)} · ${String(message.id)}`}
          >
            {message.versions.map((item) => (
              <Button
                key={String(item.id)}
                size="sm"
                aria-pressed={item.id === versionId}
                variant={item.id === versionId ? 'secondary' : 'ghost'}
                onClick={() => select(item.id)}
              >
                {t('ReaderVersion')} {String(item.number)}
              </Button>
            ))}
          </Notebook.Actions>
        </details>
      )}
    </>
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
