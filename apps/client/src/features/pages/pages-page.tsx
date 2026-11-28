import type { ProjectId, PageSummary } from '@study/contracts';
import { PageIcon, RefreshIcon } from '@study/icons';
import { IconButton, PageOverview, WorkspaceSurface } from '@study/ui';
import { Link } from '@tanstack/react-router';

import { CursorWindowActions } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { PagesArchive } from './archive';
import { PageMerges } from './merge';
import { PageContextMenu } from './page-context-menu';
import { usePageBrowse } from './use-page-browse';

/** Shows generated and saved study notes within the Practice workspace. */
export function PracticeStudyNotes({ project }: { project?: ProjectId }) {
  return (
    <WorkspaceSurface.Root variant="flow">
      <WorkspaceSurface.Content>
        <WorkspaceSurface.Body>
          <StudyNotesOverview project={project} />
        </WorkspaceSurface.Body>
      </WorkspaceSurface.Content>
    </WorkspaceSurface.Root>
  );
}

function StudyNotesOverview({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const { query: state, navigation: window } = usePageBrowse(project);

  const items = (state.isError ? [] : (state.data?.items ?? [])).filter(
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
      <SavedPages items={items} project={project} />

      <CursorWindowActions
        {...window}
        hasMore={!!state.data?.nextCursor}
        pending={state.isFetching}
        more={() => window.more(state.data?.nextCursor)}
      />
      <PagesEmpty ready={state.isSuccess} empty={!items.length} />
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
          to="/practice/study-notes/$pageId"
          params={{ pageId: String(item.id) }}
          search={project ? { project: String(project) } : {}}
        >
          <PageRowContent item={item} />
        </Link>
      </PageContextMenu>
    </li>
  );
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

function PagesEmpty({ ready, empty }: { ready: boolean; empty: boolean }) {
  const { t } = useI18n();

  return (
    <>
      {ready && empty && (
        <PageOverview.Empty>
          <PageIcon aria-hidden="true" />
          <h3>{t('PagesEmptyTitle')}</h3>
          <p>{t('PagesOverviewEmpty')}</p>
        </PageOverview.Empty>
      )}
    </>
  );
}
