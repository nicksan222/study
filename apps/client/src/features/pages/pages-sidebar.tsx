import type { ProjectId } from '@study/contracts';
import { PageIcon } from '@study/icons';
import { age } from '@study/localization';
import { RetryButton, useNowMinute, ErrorState, Loading, Sidebar } from '@study/ui';
import { Link, useParams } from '@tanstack/react-router';

import { CursorWindowActions } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';
import type { Subjects } from '#client/lib/study-client/types.ts';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { PageContextMenu } from './page-context-menu';
import { usePageBrowse } from './use-page-browse';

/** Lists published pages using the same scoped cache and rows as the library. */
export function PagesSidebar({
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
  const { pageId } = useParams({ strict: false });
  const { query: state, navigation: window } = usePageBrowse(project);
  const items = (state.data?.items ?? [])
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
    <Sidebar.Items aria-label={t('SourcePage')}>
      {state.isPending && <Loading layout="sidebar" label={t('LoadingStudy')} />}
      {state.isError && (
        <ErrorState
          layout="sidebar"
          title={t('PagesLoadError')}
          action={
            <RetryButton
              variant="ghost-muted"
              onClick={() => void state.refetch()}
              label={t('Retry')}
            />
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
          <PageContextMenu key={String(item.id)} page={item} project={project}>
            <Sidebar.Item
              layout={preferences.sidebarDensity === 'compact' ? 'compact' : 'detailed'}
              label={item.title}
              icon={<PageIcon aria-hidden="true" />}
              context={owner?.name ?? t('SourcePage')}
              description={item.description ?? t('SourcePage')}
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
              aria-current={pageId === String(item.id) ? 'page' : undefined}
              title={item.title}
              render={
                <Link
                  to="/pages/$pageId"
                  params={{ pageId: String(item.id) }}
                  search={project ? { project: String(project) } : {}}
                />
              }
            />
          </PageContextMenu>
        );
      })}
      {state.isSuccess && items.length === 0 && (
        <Sidebar.Message>{t(query.trim() ? 'SearchNoResults' : 'PagesEmpty')}</Sidebar.Message>
      )}

      <CursorWindowActions
        {...window}
        hasMore={!!state.data?.nextCursor}
        pending={state.isFetching}
        more={() => window.more(state.data?.nextCursor)}
      />
    </Sidebar.Items>
  );
}
