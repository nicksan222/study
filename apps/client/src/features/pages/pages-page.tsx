import type { ProjectId } from '@study/contracts/ids';
import { projectIdSchema } from '@study/contracts/ids';
import type { PageSummary } from '@study/contracts/pages/types';
import { OpenIcon, PageIcon, RefreshIcon } from '@study/icons';
import { IconButton } from '@study/ui/icon-button';
import { PageOverview } from '@study/ui/page-overview';
import { Link, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { CursorWindowActions } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { PagesArchive } from './archive';
import { NewBlankPage } from './creation-actions';
import { PagesFromNotes } from './from-notes';
import { PageMerges } from './merge';
import { PageContextMenu } from './page-context-menu';
import { usePageBrowse } from './use-page-browse';

/** A dedicated destination for completed pages, independent from sources and materials. */
export function PagesPage() {
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;

  return <PagesOverviewPage key={String(project)} project={project} />;
}

function PagesOverviewPage({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const archived = false;
  const { query: state, navigation: window } = usePageBrowse(project, archived);

  const items = displayedPages(state.isError, state.data ? [state.data] : undefined).filter(
    (item) => item.headVersionId !== null
  );

  return (
    <PageOverview.Root>
      <PageOverview.Heading>
        <PageOverview.Intro>
          <PageOverview.Title>{t('PagesOverviewTitle')}</PageOverview.Title>
          <PageOverview.Description>{t('PagesOverviewDescription')}</PageOverview.Description>
        </PageOverview.Intro>
        <PageOverview.Actions>
          <PagesArchive project={project} />
          <NewBlankPage key={String(project)} project={project} />
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
      <PageMerges project={project} />
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <SavedPages items={items} project={project} archived={archived} />

      <CursorWindowActions
        {...window}
        hasMore={!!state.data?.nextCursor}
        pending={state.isFetching}
        more={() => window.more(state.data?.nextCursor)}
      />
      <PagesEmpty ready={state.isSuccess} empty={!items.length} archived={archived} />
    </PageOverview.Root>
  );
}

function PageRowContent({ item }: { item: PageSummary }) {
  const { t, date } = useI18n();

  return (
    <>
      <PageOverview.Icon aria-hidden="true">
        <PageIcon />
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
          <PageRowContent item={item} />
          <OpenIcon aria-hidden="true" />
        </Link>
      </PageContextMenu>
    </li>
  );
}

function displayedPages(failed: boolean, pages?: readonly { items: readonly PageSummary[] }[]) {
  return failed ? [] : (pages?.flatMap((page) => page.items) ?? []);
}

function SavedPages({
  items,
  project,
  archived
}: {
  items: PageSummary[];
  project?: ProjectId;
  archived: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      {items.length > 0 && (
        <PageOverview.Section aria-label={t('PagesSaved')}>
          <PageOverview.SectionHeading>
            {t(archived ? 'PagesArchived' : 'PagesSaved')}
          </PageOverview.SectionHeading>
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

function PagesEmpty({
  ready,
  empty,
  archived
}: {
  ready: boolean;
  empty: boolean;
  archived: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      {ready && empty && (
        <PageOverview.Empty>
          <PageIcon aria-hidden="true" />
          <h3>{t('PagesEmptyTitle')}</h3>
          <p>{t(archived ? 'PagesArchivedEmpty' : 'PagesOverviewEmpty')}</p>
        </PageOverview.Empty>
      )}
    </>
  );
}
