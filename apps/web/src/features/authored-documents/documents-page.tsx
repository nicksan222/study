import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { ProjectId } from '@study/contracts/ids';
import { projectIdSchema } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { DocumentOverview } from '@study/ui/document-overview';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ArrowUpRight, FileText, RefreshCw } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentsOptions } from '#web/lib/study-client/documents.queries.ts';

import { ContentReadError } from '../document-presentation';
import { DocumentsArchive } from './archive';
import { NewBlankDocument } from './creation-actions';
import { DocumentContextMenu } from './document-context-menu';
import { DocumentsFromSessions } from './from-sessions';
import { DocumentMerges } from './merge';

/** A dedicated destination for completed documents, independent from sources and materials. */
export function DocumentsPage() {
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;

  return <DocumentsOverviewPage key={String(project)} project={project} />;
}

function DocumentsOverviewPage({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const archived = false;
  const state = useInfiniteQuery({
    ...documentsOptions(project, archived),
    select: (data) => ({
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.headVersionId !== null)
      }))
    })
  });

  const items = displayedDocuments(state.isError, state.data?.pages);

  return (
    <DocumentOverview.Root>
      <DocumentOverview.Heading>
        <DocumentOverview.Intro>
          <DocumentOverview.Title>{t('DocumentsOverviewTitle')}</DocumentOverview.Title>
          <DocumentOverview.Description>
            {t('DocumentsOverviewDescription')}
          </DocumentOverview.Description>
        </DocumentOverview.Intro>
        <DocumentOverview.Actions>
          <DocumentsArchive project={project} />
          <NewBlankDocument key={String(project)} project={project} />
          <DocumentsFromSessions key={String(project)} project={project} />
          <Button
            variant="ghost-muted"
            size="icon"
            aria-label={t('LibraryRefresh')}
            title={t('LibraryRefresh')}
            disabled={state.isFetching}
            onClick={() => void state.refetch()}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </DocumentOverview.Actions>
      </DocumentOverview.Heading>
      <DocumentMerges project={project} />
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <SavedDocuments items={items} project={project} archived={archived} />
      {state.hasNextPage && (
        <DocumentOverview.Footer>
          <Button
            variant="ghost"
            disabled={state.isFetchingNextPage}
            onClick={() => void state.fetchNextPage()}
          >
            {t('LibraryMore')}
          </Button>
        </DocumentOverview.Footer>
      )}
      <DocumentsEmpty ready={state.isSuccess} empty={!items.length} archived={archived} />
    </DocumentOverview.Root>
  );
}

function DocumentRowContent({ item }: { item: StudyDocumentSummary }) {
  const { t, date } = useI18n();

  return (
    <>
      <DocumentOverview.Icon aria-hidden="true">
        <FileText />
      </DocumentOverview.Icon>
      <DocumentOverview.Copy>
        <DocumentOverview.Name>{item.title}</DocumentOverview.Name>
        {item.description && (
          <DocumentOverview.Preview>{item.description}</DocumentOverview.Preview>
        )}
      </DocumentOverview.Copy>
      <DocumentOverview.Updated>
        <time dateTime={new Date(Number(item.updatedAt) * 1000).toISOString()}>
          {t('SidebarPolishUpdated', {
            date: date(item.updatedAt, { dateStyle: 'medium' })
          })}
        </time>
      </DocumentOverview.Updated>
    </>
  );
}

function DocumentRow({ item, project }: { item: StudyDocumentSummary; project?: ProjectId }) {
  return (
    <li>
      <DocumentContextMenu document={item} project={project}>
        <Link
          to="/documents/$documentId"
          params={{ documentId: String(item.id) }}
          search={project ? { project: String(project) } : {}}
        >
          <DocumentRowContent item={item} />
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </DocumentContextMenu>
    </li>
  );
}

function displayedDocuments(failed: boolean, pages?: { items: StudyDocumentSummary[] }[]) {
  return failed ? [] : (pages?.flatMap((page) => page.items) ?? []);
}

function SavedDocuments({
  items,
  project,
  archived
}: {
  items: StudyDocumentSummary[];
  project?: ProjectId;
  archived: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      {items.length > 0 && (
        <DocumentOverview.Section aria-label={t('DocumentsSaved')}>
          <DocumentOverview.SectionHeading>
            {t(archived ? 'DocumentsArchived' : 'DocumentsSaved')}
          </DocumentOverview.SectionHeading>
          <DocumentOverview.Rows>
            {items.map((item) => (
              <DocumentRow key={String(item.id)} item={item} project={project} />
            ))}
          </DocumentOverview.Rows>
        </DocumentOverview.Section>
      )}
    </>
  );
}

function DocumentsEmpty({
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
        <DocumentOverview.Empty>
          <FileText aria-hidden="true" />
          <h3>{t('DocumentsEmptyTitle')}</h3>
          <p>{t(archived ? 'DocumentsArchivedEmpty' : 'DocumentsOverviewEmpty')}</p>
        </DocumentOverview.Empty>
      )}
    </>
  );
}
