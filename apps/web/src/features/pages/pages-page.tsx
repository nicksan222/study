import type { ProjectId } from '@study/contracts/ids';
import { projectIdSchema } from '@study/contracts/ids';
import type { PageSummary } from '@study/contracts/pages/types';
import { LoadMoreButton } from '@study/ui/action-button';
import { IconButton } from '@study/ui/icon-button';
import { PageOverview } from '@study/ui/page-overview';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ArrowUpRight, FileText, RefreshCw } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';
import { pagesOptions } from '#web/lib/study-client/pages.queries.ts';

import { ContentReadError } from '../document-presentation';
import { PagesArchive } from './archive';
import { NewBlankPage } from './creation-actions';
import { PagesFromNotes } from './from-notes';
import { PageMerges } from './merge';
import { PageContextMenu } from './page-context-menu';

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
  const state = useInfiniteQuery({
    ...pagesOptions(project, archived),
    select: (data) => ({
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.headVersionId !== null)
      }))
    })
  });

  const items = displayedPages(state.isError, state.data?.pages);

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
            <RefreshCw aria-hidden="true" />
          </IconButton>
        </PageOverview.Actions>
      </PageOverview.Heading>
      <PageMerges project={project} />
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <SavedPages items={items} project={project} archived={archived} />
      {state.hasNextPage && (
        <PageOverview.Footer>
          <LoadMoreButton
            variant="ghost"
            disabled={state.isFetchingNextPage}
            onClick={() => void state.fetchNextPage()}
            label={t('LibraryMore')}
          />
        </PageOverview.Footer>
      )}
      <PagesEmpty ready={state.isSuccess} empty={!items.length} archived={archived} />
    </PageOverview.Root>
  );
}

function PageRowContent({ item }: { item: PageSummary }) {
  const { t, date } = useI18n();

  return (
    <>
      <PageOverview.Icon aria-hidden="true">
        <FileText />
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
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </PageContextMenu>
    </li>
  );
}

function displayedPages(failed: boolean, pages?: { items: PageSummary[] }[]) {
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
          <FileText aria-hidden="true" />
          <h3>{t('PagesEmptyTitle')}</h3>
          <p>{t(archived ? 'PagesArchivedEmpty' : 'PagesOverviewEmpty')}</p>
        </PageOverview.Empty>
      )}
    </>
  );
}
