import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import type { SessionId, VersionId, MaterialVersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { NotebookPen } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { versionOptions } from '../material-library';
import { MessageActions } from './message-actions';
import {
  citationsOptions,
  contextOptions,
  provenanceOptions,
  threadOptions
} from './session-workspace.queries';
import { ExecutionStatus, SessionReadError } from './status';

type Message = typeof chatMessageSchema.Type;

export function History({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const state = useInfiniteQuery(threadOptions(id));
  const messages = [
    ...new Map(
      state.data?.pages.flatMap((page) => page.items).map((message) => [message.id, message])
    ).values()
  ].toSorted((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1
  );

  return (
    <Notebook.History aria-label={t('SessionNotebook')}>
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
      {state.isSuccess && messages.length === 0 && (
        <Notebook.EmptyCanvas>
          <NotebookPen size={26} strokeWidth={1.5} aria-hidden="true" />
          <h3>{t('SessionCanvasStart')}</h3>
          <p>{t('SessionCanvasStartHelp')}</p>
        </Notebook.EmptyCanvas>
      )}
      {messages.map((message) => (
        <MessageEntry key={String(message.id)} message={message} />
      ))}
    </Notebook.History>
  );
}

function MessageEntry({ message }: { message: Message }) {
  const { t, date } = useI18n();
  const [selected, setSelected] = useState<VersionId>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const version = message.versions.find(
    (item) => item.id === (selected ?? message.activeVersionId)
  );
  const citations = useQuery({
    ...citationsOptions(message.sessionId, message.id, version?.id),
    enabled: !!version
  });

  return (
    <Notebook.Entry data-role={message.role}>
      <header>
        <strong>{t(message.role === 'user' ? 'SessionNote' : 'SessionReply')}</strong>
        <time>{date(message.createdAt)}</time>
      </header>
      {!version && <p role="status">{t('SessionReadUnavailable')}</p>}
      {version && (
        <>
          <Notebook.Prose>{version.text}</Notebook.Prose>
          <MessageActions
            message={message}
            versionId={version.id}
            onActive={() => setSelected(undefined)}
          />
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
        <ul>
          {message.parts.map((part) => (
            <li key={String(part.id)}>{part.sourceName}</li>
          ))}
        </ul>
      )}
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
    </Notebook.Entry>
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
            aria-label={`${t(message.role === 'user' ? 'SessionNote' : 'SessionReply')} · ${date(message.createdAt)} · ${String(message.id)}`}
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
