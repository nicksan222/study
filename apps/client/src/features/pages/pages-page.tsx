import { projectIdSchema } from '@study/contracts';
import type { ProjectId, PageSummary } from '@study/contracts';
import { NoteIcon, OpenIcon, PageIcon, RefreshIcon } from '@study/icons';
import { Button, IconButton, PageOverview } from '@study/ui';
import { Link, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { CursorWindowActions } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { useNoteList } from '../note-workspace';
import { PagesArchive } from './archive';
import { NewBlankPage } from './creation-actions';
import { PagesFromNotes } from './from-notes';
import { PageMerges } from './merge';
import { PageContextMenu } from './page-context-menu';
import { usePageBrowse } from './use-page-browse';

/** One subject index for existing notebooks and editable documents. */
export function PagesPage() {
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;

  return <PagesOverviewPage key={String(project)} project={project} />;
}

function PagesOverviewPage({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const { query: state, navigation: window } = usePageBrowse(project);
  const notes = useNoteList(project);

  const items = displayedPages(state.isError, state.data ? [state.data] : undefined).filter(
    (item) => item.headVersionId !== null
  );

  return (
    <PageOverview.Root>
      <PageOverview.Heading>
        <PageOverview.Intro>
          <PageOverview.Title>{t('Documents')}</PageOverview.Title>
        </PageOverview.Intro>
        <PageOverview.Actions>
          <PagesArchive project={project} />
          <NewBlankPage key={String(project)} project={project} />
          <Button
            variant="outline"
            render={
              <Link to="/notes" search={{ project: project?.toString(), notebookDraft: '1' }} />
            }
          >
            {t('NewNote')}
          </Button>
          <PagesFromNotes key={String(project)} project={project} />
          <IconButton
            variant="ghost-muted"
            size="icon"
            label={t('LibraryRefresh')}

            disabled={state.isFetching}
            onClick={() => void state.refetch()}
          >
            <RefreshIcon aria-hidden="true" />
          </IconButton>
        </PageOverview.Actions>
      </PageOverview.Heading>
      <NotebookRows project={project} notes={notes} />
      <PageMerges project={project} />
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <SavedPages items={items} project={project} />

      <CursorWindowActions
        {...window}
        hasMore={!!state.data?.nextCursor}
        pending={state.isFetching}
        more={() => window.more(state.data?.nextCursor)}
      />
      <DocumentsEmpty
        visible={state.isSuccess && notes.isSuccess && !items.length && !notes.data?.items.length}
      />
    </PageOverview.Root>
  );
}

function DocumentRowContent({
  item,
  notebook = false
}: {
  item: Pick<PageSummary, 'title' | 'description' | 'updatedAt'>;
  notebook?: boolean;
}) {
  const { t, date } = useI18n();

  return (
    <>
      <PageOverview.Icon aria-hidden="true">
        {notebook ? <NoteIcon /> : <PageIcon />}
      </PageOverview.Icon>
      <PageOverview.Copy>
        <PageOverview.Name>{item.title}</PageOverview.Name>
        {item.description && <PageOverview.Preview>{item.description}</PageOverview.Preview>}
      </PageOverview.Copy>
      <PageOverview.Updated>
        <time dateTime={new Date(Number(item.updatedAt) * 1000).toISOString()}>
          {t('SidebarPolishUpdated', {
            date: date(item.updatedAt, { dateStyle: 'medium' })
          })}
        </time>
      </PageOverview.Updated>
    </>
  );
}

function PageRow({ item, project }: { item: PageSummary; project?: ProjectId }) {
  return (
    <li>
      <PageContextMenu page={item} project={project}>
        <Link
          to="/pages/$pageId"
          params={{ pageId: String(item.id) }}
          search={project ? { project: String(project) } : {}}
        >
          <DocumentRowContent item={item} />
          <OpenIcon aria-hidden="true" />
        </Link>
      </PageContextMenu>
    </li>
  );
}

function displayedPages(failed: boolean, pages?: readonly { items: readonly PageSummary[] }[]) {
  return failed ? [] : (pages?.flatMap((page) => page.items) ?? []);
}

function SavedPages({ items, project }: { items: PageSummary[]; project?: ProjectId }) {
  const { t } = useI18n();

  return (
    <>
      {items.length > 0 && (
        <PageOverview.Section aria-label={t('PagesSaved')}>
          <PageOverview.SectionHeading>{t('PagesSaved')}</PageOverview.SectionHeading>
          <PageOverview.Rows>
            {items.map((item) => (
              <PageRow key={String(item.id)} item={item} project={project} />
            ))}
          </PageOverview.Rows>
        </PageOverview.Section>
      )}
    </>
  );
}

function DocumentsEmpty({ visible }: { visible: boolean }) {
  const { t } = useI18n();

  return visible ? (
    <PageOverview.Empty>
      <PageIcon aria-hidden="true" />
      <h3>{t('DocumentsEmpty')}</h3>
    </PageOverview.Empty>
  ) : null;
}

function NotebookRows({
  project,
  notes
}: {
  project?: ProjectId;
  notes: ReturnType<typeof useNoteList>;
}) {
  const { t } = useI18n();

  if (notes.error)
    return <ContentReadError error={notes.error} retry={() => void notes.refetch()} />;

  const items = notes.data?.items ?? [];

  if (!items.length) return null;

  return (
    <PageOverview.Section aria-label={t('Notes')}>
      <PageOverview.SectionHeading>{t('Notes')}</PageOverview.SectionHeading>
      <PageOverview.Rows>
        {items.map((note) => (
          <li key={String(note.id)}>
            <Link
              to="/notes/$noteId"
              params={{ noteId: note.id }}
              search={{ project: project?.toString() }}
            >
              <DocumentRowContent item={{ ...note, description: null }} notebook />
              <OpenIcon aria-hidden="true" />
            </Link>
          </li>
        ))}
      </PageOverview.Rows>
      <CursorWindowActions
        {...notes.pagination}
        hasMore={notes.hasNextPage}
        pending={notes.isFetchingNextPage}
        more={notes.fetchNextPage}
      />
    </PageOverview.Section>
  );
}
