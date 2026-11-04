import type {
  ArchivedSessionItem,
  SessionArchiveTarget
} from '@study/contracts/conversations/archive';
import type { MessageId, SessionId, SourceId, StudyDocumentId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ChatMessage, ChatMessageText } from '@study/ui/chat';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { SelectionSurface as Surface } from '@study/ui/selection';
import { Notebook } from '@study/ui/session-workspace';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, FileInput, Search, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { request } from '#web/lib/study-client/request.ts';

import { DocumentNotebookDeletion } from '../authored-documents/notebook-deletion';
import { DocumentReader } from '../document-presentation';
import { SourceDeletion, sourceOptions, sourceExtractionOptions } from '../source-library';
import { archivedItemsOptions, useItemArchive } from './archive.queries';
import { MessageDeletion } from './message-deletion';
import { NoteContent } from './note-editor';
import { sessionDocumentOptions } from './session-document.queries';
import { SessionError, SessionReadError } from './status';

const itemKey = (target: SessionArchiveTarget) => target.kind + ':' + String(target.id);

export function ArchivePanel({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const items = useQuery(archivedItemsOptions(id));
  const [selected, setSelected] = useState<string>();
  const [search, setSearch] = useState('');
  const available = items.isError ? [] : (items.data ?? []);
  const active = available.find((item) => itemKey(item.target) === selected);
  return (
    <Surface.Root>
      <ArchiveNavigation
        available={available}
        selected={selected}
        onSelect={setSelected}
        search={search}
        onSearch={setSearch}
        pending={items.isPending}
        loaded={items.isSuccess}
      />
      <Surface.Main>
        <Surface.Header>
          <h2>{active?.name ?? t('SessionArchived')}</h2>
        </Surface.Header>
        {active && !items.isError ? (
          <ArchivedPreview key={itemKey(active.target)} sessionId={id} item={active} />
        ) : (
          <Surface.Scroll>
            <Surface.Body>
              <ArchiveOverview
                pending={items.isPending}
                failed={items.isError}
                hasItems={available.length > 0}
                retry={() => void items.refetch()}
              />
            </Surface.Body>
          </Surface.Scroll>
        )}
      </Surface.Main>
    </Surface.Root>
  );
}

function ArchiveOverview({
  pending,
  failed,
  hasItems,
  retry
}: {
  pending: boolean;
  failed: boolean;
  hasItems: boolean;
  retry: () => void;
}) {
  const { t } = useI18n();
  if (pending) return <Loading label={t('LoadingStudy')} />;
  if (failed)
    return (
      <ErrorState
        title={t('SessionArchiveLoadFailed')}
        description={t('SessionArchiveLoadFailedHelp')}
        action={
          <Button size="sm" variant="outline" onClick={retry}>
            {t('Retry')}
          </Button>
        }
      />
    );
  return (
    <Surface.Empty role="status">
      <strong>{t(hasItems ? 'SessionArchiveChoose' : 'SessionArchiveEmpty')}</strong>
      <Notebook.Muted>{t('SessionArchiveEmptyHelp')}</Notebook.Muted>
    </Surface.Empty>
  );
}

function ArchiveNavigation({
  available,
  selected,
  onSelect,
  search,
  onSearch,
  pending,
  loaded
}: {
  available: readonly ArchivedSessionItem[];
  selected?: string;
  onSelect: (key: string) => void;
  search: string;
  onSearch: (value: string) => void;
  pending: boolean;
  loaded: boolean;
}) {
  const { t } = useI18n();
  const searchId = useId();
  const filtered = available.filter((item) =>
    item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  return (
    <Surface.Navigation aria-label={t('SessionArchived')}>
      <Surface.Search htmlFor={searchId}>
        <Search aria-hidden="true" />
        <Input
          id={searchId}
          type="search"
          aria-label={t('SessionArchiveSearch')}
          placeholder={t('Search')}
          value={search}
          onValueChange={onSearch}
        />
      </Surface.Search>
      {pending && <Loading label={t('LoadingStudy')} />}
      <Surface.Materials>
        {filtered.map((item) => (
          <li key={itemKey(item.target)}>
            <Surface.Material
              type="button"
              title={item.name}
              aria-current={itemKey(item.target) === selected ? 'page' : undefined}
              onClick={() => onSelect(itemKey(item.target))}
            >
              {item.target.kind === 'source' ? (
                <FileInput aria-hidden="true" />
              ) : (
                <FileText aria-hidden="true" />
              )}
              <span>{item.name}</span>
            </Surface.Material>
          </li>
        ))}
      </Surface.Materials>
      {loaded && !!search.trim() && !filtered.length && (
        <Notebook.Status role="status">{t('SessionArchiveNoMatches')}</Notebook.Status>
      )}
    </Surface.Navigation>
  );
}

function ArchivedPreview({ sessionId, item }: { sessionId: SessionId; item: ArchivedSessionItem }) {
  const cache = useQueryClient();
  const onDeleted = () => {
    void cache.invalidateQueries(archivedItemsOptions(sessionId));
  };
  const props = { sessionId, onDeleted };
  if (item.target.kind === 'message') return <ArchivedMessage {...props} id={item.target.id} />;
  if (item.target.kind === 'document') return <ArchivedDocument {...props} id={item.target.id} />;
  return <ArchivedSource {...props} id={item.target.id} />;
}

type PreviewProps = { sessionId: SessionId; onDeleted: () => void };

function ArchiveActions({
  sessionId,
  target,
  children,
  blocked = false
}: {
  sessionId: SessionId;
  target: SessionArchiveTarget;
  blocked?: boolean;
  children: (pending: boolean) => ReactNode;
}) {
  const { t } = useI18n();
  const archive = useItemArchive(sessionId, target);
  return (
    <Surface.ArchiveFooter aria-busy={archive.pending}>
      <Surface.ArchiveActions>
        <Notebook.Muted>{t('SessionArchiveHelp')}</Notebook.Muted>
        <Surface.DocumentActions>
          {children(archive.pending)}
          <Button
            size="sm"
            disabled={archive.pending || blocked}
            onClick={() => archive.change(false)}
          >
            <RotateCcw aria-hidden="true" />
            {t('SessionRestore')}
          </Button>
        </Surface.DocumentActions>
      </Surface.ArchiveActions>
      {archive.error && <SessionError error={archive.error} />}
    </Surface.ArchiveFooter>
  );
}

function ArchivedMessage({ id, sessionId, onDeleted }: PreviewProps & { id: MessageId }) {
  const { t } = useI18n();
  const message = useQuery({
    queryKey: ['session-archive-message', String(id)],
    queryFn: ({ signal }) => request((rpc) => rpc['conversations.message']({ id }), signal)
  });
  if (message.error)
    return <SessionReadError error={message.error} retry={() => void message.refetch()} />;
  if (!message.data) return <Loading label={t('LoadingStudy')} />;
  const value = message.data;
  const version = value.versions.find((v) => v.id === value.activeVersionId);
  return (
    <Surface.ArchiveFrame>
      <Surface.ArchiveReading>
        <Surface.ArchiveContent>
          <ArchiveContext>
            <ChatMessage data-role={value.role}>
              {version ? (
                value.format === 'document' || value.role === 'assistant' ? (
                  <NoteContent value={version.text} />
                ) : (
                  <ChatMessageText text={version.text} />
                )
              ) : (
                <Notebook.Status>{t('SessionReadUnavailable')}</Notebook.Status>
              )}
            </ChatMessage>
          </ArchiveContext>
        </Surface.ArchiveContent>
      </Surface.ArchiveReading>
      {version && (
        <MessageDeletion
          message={value}
          versionId={version.id}
          onDeleted={onDeleted}
          renderActions={(actions) => (
            <ArchiveActions
              sessionId={sessionId}
              target={{ kind: 'message', id }}
              blocked={actions.open}
            >
              {(pending) => (
                <Button
                  size="sm"
                  variant="ghost-destructive"
                  disabled={pending || actions.disabled}
                  onClick={actions.onDeleteItem}
                >
                  {t('SessionDeletePermanently')}
                </Button>
              )}
            </ArchiveActions>
          )}
        />
      )}
    </Surface.ArchiveFrame>
  );
}

function ArchivedDocument({ id, sessionId, onDeleted }: PreviewProps & { id: StudyDocumentId }) {
  const { t } = useI18n();
  const document = useQuery(sessionDocumentOptions(id));
  if (document.error)
    return <SessionReadError error={document.error} retry={() => void document.refetch()} />;
  if (!document.data) return <Loading label={t('LoadingStudy')} />;
  return (
    <Surface.ArchiveFrame>
      <Surface.ArchiveReading>
        <Surface.ArchiveContent>
          <ArchiveContext>
            {document.data.version ? (
              <DocumentReader document={document.data.version.document} />
            ) : (
              <Notebook.Status>{t('SessionReadUnavailable')}</Notebook.Status>
            )}
          </ArchiveContext>
        </Surface.ArchiveContent>
      </Surface.ArchiveReading>
      <DocumentNotebookDeletion
        document={document.data}
        onDeleted={onDeleted}
        renderActions={(actions) => (
          <ArchiveActions
            sessionId={sessionId}
            target={{ kind: 'document', id }}
            blocked={actions.open}
          >
            {(pending) => (
              <Button
                size="sm"
                variant="ghost-destructive"
                disabled={pending}
                onClick={actions.onDeleteItem}
              >
                {t('SessionDeletePermanently')}
              </Button>
            )}
          </ArchiveActions>
        )}
      />
    </Surface.ArchiveFrame>
  );
}

function ArchivedSource({ id, sessionId, onDeleted }: PreviewProps & { id: SourceId }) {
  const { t } = useI18n();
  const source = useQuery(sourceOptions(id));
  const extraction = useQuery(sourceExtractionOptions(id));
  if (source.error)
    return <SessionReadError error={source.error} retry={() => void source.refetch()} />;
  if (!source.data) return <Loading label={t('LoadingStudy')} />;
  return (
    <Surface.ArchiveFrame>
      <Surface.ArchiveReading>
        <Surface.ArchiveContent>
          <ArchiveContext>
            {extraction.error ? (
              <SessionReadError error={extraction.error} retry={() => void extraction.refetch()} />
            ) : extraction.isPending ? (
              <Loading label={t('LoadingStudy')} />
            ) : extraction.data ? (
              <DocumentReader document={extraction.data.document} />
            ) : (
              <Notebook.Status>{t('SessionReadUnavailable')}</Notebook.Status>
            )}
          </ArchiveContext>
        </Surface.ArchiveContent>
      </Surface.ArchiveReading>
      <SourceDeletion
        source={source.data}
        onDeleted={onDeleted}
        renderTrigger={(show, open) => (
          <ArchiveActions sessionId={sessionId} target={{ kind: 'source', id }} blocked={open}>
            {(pending) => (
              <Button size="sm" variant="ghost-destructive" disabled={pending} onClick={show}>
                {t('SessionDeletePermanently')}
              </Button>
            )}
          </ArchiveActions>
        )}
      />
    </Surface.ArchiveFrame>
  );
}

function ArchiveContext({ children }: { children: ReactNode }) {
  return (
    <Surface.ArchiveContext>
      <ArchivePlaceholder />
      <Surface.ArchiveHighlight>{children}</Surface.ArchiveHighlight>
      <ArchivePlaceholder />
    </Surface.ArchiveContext>
  );
}
function ArchivePlaceholder() {
  return (
    <ChatMessage aria-hidden="true">
      <Surface.ArchivePlaceholder>
        <span />
        <span />
        <span />
      </Surface.ArchivePlaceholder>
    </ChatMessage>
  );
}
