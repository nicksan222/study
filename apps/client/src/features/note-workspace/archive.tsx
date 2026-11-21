import type {
  MessageId,
  NoteId,
  PageId,
  ArchivedNoteItem,
  NoteArchiveTarget
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { PageIcon, RestoreIcon } from '@study/icons';
import {
  RetryButton,
  Button,
  ChatMessage,
  ErrorState,
  Loading,
  Notebook,
  SelectionSurface as Surface
} from '@study/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { PageNotebookDeletion } from '../document-editing';
import { DocumentReader } from '../document-presentation';
import { useItemArchive } from './archive.queries';
import { MessageContent, useMessageCitations } from './message-citations';
import { MessageDeletion } from './message-deletion';
import { NoteError, NoteReadError } from './status';

const itemKey = (target: NoteArchiveTarget) => target.kind + ':' + String(target.id);

export function ArchivePanel({ id }: { id: NoteId }) {
  const { t } = useI18n();
  const items = rpc.notes.archivedItems.useQuery({ noteId: id });
  const [selected, setSelected] = useState<string>();
  const [search, setSearch] = useState('');
  const available = items.isError
    ? []
    : (items.data ?? []).filter((item) => item.target.kind !== 'source');
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
        <Surface.DetailHeader title={<>{active?.name ?? t('NoteArchived')}</>} />
        {active && !items.isError ? (
          <ArchivedPreview key={itemKey(active.target)} noteId={id} item={active} />
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
        title={t('NoteArchiveLoadFailed')}
        description={t('NoteArchiveLoadFailedHelp')}
        action={<RetryButton size="sm" variant="outline" onClick={retry} label={t('Retry')} />}
      />
    );

  return (
    <Surface.EmptyState
      title={<>{t(hasItems ? 'NoteArchiveChoose' : 'NoteArchiveEmpty')}</>}
      description={<>{t('NoteArchiveEmptyHelp')}</>}
    />
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
  available: readonly ArchivedNoteItem[];
  selected?: string;
  onSelect: (key: string) => void;
  search: string;
  onSearch: (value: string) => void;
  pending: boolean;
  loaded: boolean;
}) {
  const { t } = useI18n();
  const filtered = available.filter((item) =>
    item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );

  return (
    <Surface.Navigation aria-label={t('NoteArchived')}>
      <Surface.SearchField
        label={t('NoteArchiveSearch')}
        placeholder={t('Search')}
        value={search}
        onValueChange={onSearch}
      />
      {pending && <Loading label={t('LoadingStudy')} />}
      <Surface.Materials>
        {filtered.map((item) => (
          <li key={itemKey(item.target)}>
            <Surface.Item
              type="button"
              label={item.name}
              aria-current={itemKey(item.target) === selected ? 'page' : undefined}
              onClick={() => onSelect(itemKey(item.target))}
              icon={<PageIcon aria-hidden="true" />}
            />
          </li>
        ))}
      </Surface.Materials>
      {loaded && !!search.trim() && !filtered.length && (
        <Notebook.Status role="status">{t('NoteArchiveNoMatches')}</Notebook.Status>
      )}
    </Surface.Navigation>
  );
}

function ArchivedPreview({ noteId, item }: { noteId: NoteId; item: ArchivedNoteItem }) {
  const onDeleted = () => {};
  const props = { noteId, onDeleted };

  if (item.target.kind === 'message') return <ArchivedMessage {...props} id={item.target.id} />;

  if (item.target.kind === 'page') return <ArchivedPage {...props} id={item.target.id} />;

  return null;
}

type PreviewProps = { noteId: NoteId; onDeleted: () => void };

function ArchiveActions({
  noteId,
  target,
  children,
  blocked = false
}: {
  noteId: NoteId;
  target: NoteArchiveTarget;
  blocked?: boolean;
  children: (pending: boolean) => ReactNode;
}) {
  const { t } = useI18n();
  const archive = useItemArchive(noteId, target);

  return (
    <Surface.ArchiveFooter aria-busy={archive.pending}>
      <Surface.ArchiveActions>
        <Notebook.Muted>{t('NoteArchiveHelp')}</Notebook.Muted>
        <Surface.PageActions>
          {children(archive.pending)}
          <Button
            size="sm"
            disabled={archive.pending || blocked}
            onClick={() => archive.change(false)}
          >
            <RestoreIcon aria-hidden="true" />
            {t('NoteRestore')}
          </Button>
        </Surface.PageActions>
      </Surface.ArchiveActions>
      {archive.error && <NoteError error={archive.error} />}
    </Surface.ArchiveFooter>
  );
}

function ArchivedMessage({ id, noteId, onDeleted }: PreviewProps & { id: MessageId }) {
  const { t } = useI18n();
  const message = rpc.notes.message.useQuery({ id: id });
  const value = message.data;
  const version = value?.versions.find((v) => v.id === value.activeVersionId);

  if (message.error)
    return <NoteReadError error={message.error} retry={() => void message.refetch()} />;

  if (!value) return <Loading label={t('LoadingStudy')} />;

  return (
    <Surface.ArchiveFrame>
      <Surface.ArchiveReading>
        <Surface.ArchiveContent>
          <ArchiveContext>
            <ChatMessage data-role={value.role}>
              {version ? (
                <ArchivedMessageContent message={value} version={version} />
              ) : (
                <Notebook.Status>{t('NoteReadUnavailable')}</Notebook.Status>
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
            <ArchiveActions noteId={noteId} target={{ kind: 'message', id }} blocked={actions.open}>
              {(pending) => (
                <Button
                  size="sm"
                  variant="ghost-destructive"
                  disabled={pending || actions.disabled}
                  onClick={actions.onDeleteItem}
                >
                  {t('NoteDeletePermanently')}
                </Button>
              )}
            </ArchiveActions>
          )}
        />
      )}
    </Surface.ArchiveFrame>
  );
}

function ArchivedMessageContent(props: Omit<Parameters<typeof MessageContent>[0], 'citations'>) {
  const { items } = useMessageCitations(props.message, props.version.id);

  return <MessageContent {...props} citations={items} />;
}

function ArchivedPage({ id, noteId, onDeleted }: PreviewProps & { id: PageId }) {
  const { t } = useI18n();
  const page = rpc.pages.get.useQuery({ id: id });

  if (page.error) return <NoteReadError error={page.error} retry={() => void page.refetch()} />;

  if (!page.data) return <Loading label={t('LoadingStudy')} />;

  return (
    <Surface.ArchiveFrame>
      <Surface.ArchiveReading>
        <Surface.ArchiveContent>
          <ArchiveContext>
            {page.data.version ? (
              <DocumentReader document={page.data.version.document} />
            ) : (
              <Notebook.Status>{t('NoteReadUnavailable')}</Notebook.Status>
            )}
          </ArchiveContext>
        </Surface.ArchiveContent>
      </Surface.ArchiveReading>
      <PageNotebookDeletion
        page={page.data}
        onDeleted={onDeleted}
        renderActions={(actions) => (
          <ArchiveActions noteId={noteId} target={{ kind: 'page', id }} blocked={actions.open}>
            {(pending) => (
              <Button
                size="sm"
                variant="ghost-destructive"
                disabled={pending}
                onClick={actions.onDeleteItem}
              >
                {t('NoteDeletePermanently')}
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
