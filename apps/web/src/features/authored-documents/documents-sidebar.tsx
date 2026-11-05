import type { ProjectId } from '@study/contracts/ids';
import { age } from '@study/localization';
import { Button } from '@study/ui/button';
import { useNowMinute } from '@study/ui/clock';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Sidebar } from '@study/ui/sidebar';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { FileText } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentsOptions } from '#web/lib/study-client/documents.queries.ts';
import type { Subjects } from '#web/lib/study-client/operations.ts';
import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

/** Lists published documents using the same scoped cache and rows as the library. */
export function DocumentsSidebar({
  project,
  subjects,
  query = ''
}: {
  project?: ProjectId;
  subjects: Subjects;
  query?: string;
}) {
  const { t, locale, date } = useI18n();
  const now = useNowMinute();
  const preferences = useWorkspacePreferences();
  const { documentId } = useParams({ strict: false });
  const state = useInfiniteQuery({
    ...documentsOptions(project),
    refetchOnWindowFocus: 'always',
    refetchInterval: 15_000
  });
  const items = (state.data?.pages.flatMap((page) => page.items) ?? [])
    .filter(
      (item) =>
        item.headVersionId !== null &&
        item.archivedAt === null &&
        (!project || item.projectIds.includes(project)) &&
        item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    )
    .toSorted((a, b) =>
      a.updatedAt === b.updatedAt ? (a.id > b.id ? -1 : 1) : a.updatedAt > b.updatedAt ? -1 : 1
    );

  return (
    <Sidebar.Items aria-label={t('SourceDocument')}>
      {state.isPending && <Loading layout="sidebar" label={t('LoadingStudy')} />}
      {state.isError && (
        <ErrorState
          layout="sidebar"
          title={t('DocumentsLoadError')}
          action={
            <Button variant="ghost-muted" onClick={() => void state.refetch()}>
              {t('Retry')}
            </Button>
          }
        />
      )}
      {items.map((item) => {
        const owner = subjects.find(
          (subject) =>
            item.projectIds.includes(subject.id) &&
            (subject.id === project || subject.id === item.projectIds[0])
        );

        return (
          <Sidebar.Item
            key={String(item.id)}
            layout={preferences.sidebarDensity === 'compact' ? 'compact' : 'detailed'}
            label={item.title}
            icon={<FileText aria-hidden="true" />}
            context={owner?.name ?? t('SourceDocument')}
            description={item.description ?? t('SourceDocument')}
            timestamp={
              <time
                dateTime={new Date(Number(item.updatedAt) * 1000).toISOString()}
                title={date(item.updatedAt)}
              >
                {preferences.sidebarTimeFormat === 'absolute'
                  ? date(item.updatedAt)
                  : age(locale, now - Number(item.updatedAt))}
              </time>
            }
            aria-label={item.title}
            aria-current={documentId === String(item.id) ? 'page' : undefined}
            title={item.title}
            render={
              <Link
                to="/documents/$documentId"
                params={{ documentId: String(item.id) }}
                search={project ? { project: String(project) } : {}}
              />
            }
          />
        );
      })}
      {state.isSuccess && items.length === 0 && (
        <Sidebar.Message>{t(query.trim() ? 'SearchNoResults' : 'DocumentsEmpty')}</Sidebar.Message>
      )}
      {state.hasNextPage && (
        <Sidebar.SessionMore
          disabled={state.isFetchingNextPage}
          onClick={() => void state.fetchNextPage()}
        >
          {state.isFetchingNextPage ? t('LoadingStudy') : t('LibraryMore')}
        </Sidebar.SessionMore>
      )}
    </Sidebar.Items>
  );
}
