import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import type { SessionId, VersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { NotebookPen } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { versionOptions } from '../material-library/material-library.queries';
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
    <section aria-label={t('SessionNotebook')} className="session-history">
      {state.isPending && <p role="status">{t('LoadingStudy')}</p>}
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
        <div className="session-empty-canvas">
          <NotebookPen size={26} strokeWidth={1.5} aria-hidden="true" />
          <h3>{t('SessionCanvasStart')}</h3>
          <p>{t('SessionCanvasStartHelp')}</p>
        </div>
      )}
      {messages.map((message) => (
        <MessageEntry key={String(message.id)} message={message} />
      ))}
    </section>
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
    <article className="session-entry" data-role={message.role}>
      <header>
        <strong>{t(message.role === 'user' ? 'SessionNote' : 'SessionReply')}</strong>
        <time>{date(message.createdAt)}</time>
      </header>
      {!version && <p role="status">{t('SessionReadUnavailable')}</p>}
      {version && (
        <>
          <div className="session-prose">{version.text}</div>
          <MessageActions
            message={message}
            versionId={version.id}
            onActive={() => setSelected(undefined)}
          />
          {version.status !== 'complete' && <p role="status">{t('SessionPending')}</p>}
          {message.versions.length > 1 && (
            <details
              open={historyOpen}
              onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
            >
              <summary>{t('SessionVersions')}</summary>
              <div
                className="session-actions"
                role="group"
                aria-label={`${t(message.role === 'user' ? 'SessionNote' : 'SessionReply')} · ${date(message.createdAt)} · ${String(message.id)}`}
              >
                {message.versions.map((item) => (
                  <Button
                    key={String(item.id)}
                    size="sm"
                    aria-pressed={item.id === version.id}
                    variant={item.id === version.id ? 'secondary' : 'ghost'}
                    onClick={() => setSelected(item.id)}
                  >
                    {t('ReaderVersion')} {String(item.number)}
                  </Button>
                ))}
              </div>
            </details>
          )}
          {(message.role === 'assistant' ||
            (version.origin !== 'typed' && version.origin !== 'edited')) && (
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
            {citations.data.citations.map((citation, index) => (
              <li key={`${citation.marker}-${index}`}>
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
                <p className="session-muted">
                  {t(
                    citation.precision === 'exact'
                      ? 'SessionExactEvidence'
                      : citation.precision === 'approximate'
                        ? 'SessionApproximateEvidence'
                        : 'SessionEvidenceUnavailable'
                  )}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}
function CitationLink({
  versionId,
  name
}: {
  versionId: import('@study/contracts/ids').MaterialVersionId;
  name: string;
}) {
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
  const available =
    !provenance.isError && provenance.data?.state === 'available'
      ? provenance.data.requestId
      : undefined;
  return (
    <>
      {pending && available && <ExecutionStatus requestId={available} />}
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>{t('SessionContextUsed')}</summary>
        {provenance.isPending && open && <p role="status">{t('LoadingStudy')}</p>}
        {provenance.error && (
          <SessionReadError error={provenance.error} retry={() => void provenance.refetch()} />
        )}
        {!provenance.isError && provenance.data?.state === 'manual' && (
          <p>{t('SessionManualVersion')}</p>
        )}
        {!provenance.isError &&
          (provenance.data?.state === 'retired' || provenance.data?.state === 'unavailable') && (
            <p>{t('SessionContextUnavailable')}</p>
          )}
        {open && available && <CapturedContext requestId={available} />}
      </details>
    </>
  );
}
export function CapturedContext({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const state = useQuery(contextOptions(requestId));
  return (
    <div className="session-captured">
      {state.isPending && <p role="status">{t('LoadingStudy')}</p>}
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {state.data && !state.isError && (
        <>
          <p className="session-muted">
            {t('SessionCapturedHelp')} · {t('SessionRevision')}{' '}
            {String(state.data.selectionRevision)}
          </p>
          {state.data.instruction && <p className="session-prose">{state.data.instruction}</p>}
          <ul>
            {state.data.inputs.map((input, index) => (
              <li key={`${input.versionId}-${index}`}>
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
                {input.excerpts.map((excerpt, ordinal) => (
                  <blockquote key={`${excerpt.blockId}-${ordinal}`}>
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
              <div key={`${message.messageId}-${message.versionId}`} className="session-prose">
                {message.text}
              </div>
            ))}
          </details>
          {state.data.excludedMessages > 0 && (
            <p>
              {t('SessionExcludedNotes')} {state.data.excludedMessages}
            </p>
          )}
        </>
      )}
    </div>
  );
}
