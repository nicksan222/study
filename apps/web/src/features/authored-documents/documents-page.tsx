import { projectIdSchema } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { DocumentOverview } from '@study/ui/document-overview';
import { Loading } from '@study/ui/loading';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ArrowUpRight, FileText, RefreshCw } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentsOptions } from '#web/lib/study-client/documents.queries.ts';

import { ContentReadError } from '../document-presentation';
import { NewBlankDocument } from './creation-actions';
import { DocumentContextMenu } from './document-context-menu';
import { DocumentsFromSessions } from './from-sessions';

/** A dedicated destination for completed documents, independent from sources and materials. */
export function DocumentsPage() {
  const { t, date } = useI18n();
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;
  const state = useInfiniteQuery({
    ...documentsOptions(project),
    select: (data) => ({
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.headVersionId !== null)
      }))
    })
  });

  const items = state.isError ? [] : (state.data?.pages.flatMap((page) => page.items) ?? []);

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
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      {items.length > 0 && (
        <DocumentOverview.Section aria-label={t('DocumentsSaved')}>
          <DocumentOverview.SectionHeading>{t('DocumentsSaved')}</DocumentOverview.SectionHeading>
          <DocumentOverview.Rows>
            {items.map((item) => (
              <li key={String(item.id)}>
                <DocumentContextMenu document={item} project={project}>
                  <Link
                    to="/documents/$documentId"
                    params={{ documentId: String(item.id) }}
                    search={project ? { project: String(project) } : {}}
                  >
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
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                </DocumentContextMenu>
              </li>
            ))}
          </DocumentOverview.Rows>
        </DocumentOverview.Section>
      )}
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
      {state.isSuccess && !items.length && (
        <DocumentOverview.Empty>
          <FileText aria-hidden="true" />
          <h3>{t('DocumentsEmptyTitle')}</h3>
          <p>{t('DocumentsOverviewEmpty')}</p>
        </DocumentOverview.Empty>
      )}
    </DocumentOverview.Root>
  );
}
