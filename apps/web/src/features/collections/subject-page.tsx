import type { ProjectId } from '@study/contracts/ids';
import type { Project } from '@study/contracts/projects/schemas';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { List } from '@study/ui/list';
import { Loading } from '@study/ui/loading';
import { SubjectWorkspace } from '@study/ui/subject-workspace';
import { useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowUpRight,
  FileText,
  Files,
  MessagesSquare,
  Plus,
  Settings2,
  Sparkles
} from 'lucide-react';
import { useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { pagesOptions } from '#web/lib/study-client/pages.queries.ts';

import { materialsOptions } from '../material-library';
import { paginatedNotesOptions } from '../note-workspace';
import { subjectSourcesOptions } from '../source-library';
import { SubjectIdentity } from '../subjects';
import { subjectProjectOptions } from './collections.queries';
import { SubjectManagement } from './project-settings';

/** Reads only the explicitly selected subject; a failed identity never exposes global content. */
export function SubjectPage({ project }: { project: ProjectId }) {
  const state = useSuspenseQuery(subjectProjectOptions(project));

  return <SubjectContents project={state.data} />;
}

function SubjectContents({ project }: { project: Project }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [managing, setManaging] = useState(false);
  const search = { project: String(project.id) };

  return (
    <SubjectWorkspace.Root>
      <SubjectWorkspace.Header>
        <SubjectWorkspace.Identity>
          <SubjectIdentity name={project.name} icon={project.icon} size="large" />
          <SubjectWorkspace.Title>{project.name}</SubjectWorkspace.Title>
        </SubjectWorkspace.Identity>
        <SubjectWorkspace.Actions>
          <Button variant="outline" aria-pressed={managing} onClick={() => setManaging(!managing)}>
            <Settings2 aria-hidden="true" />
            {t(managing ? 'SubjectWorkspaceContents' : 'SubjectWorkspaceManage')}
          </Button>
          <Button render={<Link to="/notes" search={search} />}>
            <Plus aria-hidden="true" />
            {t('NewNote')}
          </Button>
        </SubjectWorkspace.Actions>
      </SubjectWorkspace.Header>
      {managing ? (
        <SubjectManagement
          project={project}
          onDeleted={() => void navigate({ to: '/projects', search: {} })}
        />
      ) : (
        <SubjectWorkspace.Content>
          <SubjectNotes project={project.id} />
          <SubjectPages project={project.id} />
          <SubjectSources project={project.id} />
          <SubjectMaterials project={project.id} />
        </SubjectWorkspace.Content>
      )}
    </SubjectWorkspace.Root>
  );
}

type ReadState = {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  hasNextPage?: boolean;
  refetch: () => unknown;
  fetchNextPage?: () => unknown;
};

function ContentSection({
  title,
  state,
  empty,
  children
}: {
  title: string;
  state: ReadState;
  empty: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <SubjectWorkspace.Section aria-label={title}>
      <SubjectWorkspace.SectionTitle>{title}</SubjectWorkspace.SectionTitle>
      {state.isPending ? (
        <Loading label={t('LoadingStudy')} />
      ) : state.isError ? (
        <ErrorState
          layout="inline"
          title={t('collections.readError')}
          action={<RetryButton onClick={() => void state.refetch()} label={t('Retry')} />}
        />
      ) : empty ? (
        <SubjectWorkspace.EmptyList>{t('SubjectWorkspaceEmpty')}</SubjectWorkspace.EmptyList>
      ) : (
        <List bleed={false}>{children}</List>
      )}
      {state.hasNextPage && (
        <Button
          variant="ghost"
          disabled={state.isFetching}
          onClick={() => void state.fetchNextPage?.()}
        >
          {t('collections.more')}
        </Button>
      )}
    </SubjectWorkspace.Section>
  );
}

function ContentRow({
  title,
  icon,
  render,
  updated
}: {
  title: string;
  icon: ReactNode;
  render: ComponentProps<typeof List.Row>['render'];
  updated?: string;
}) {
  return (
    <List.Row render={render}>
      <List.Icon>{icon}</List.Icon>
      <List.Main>
        <List.Title>{title}</List.Title>
        {updated && <List.Description>{updated}</List.Description>}
      </List.Main>
      <List.Meta>
        <ArrowUpRight size={16} aria-hidden="true" />
      </List.Meta>
    </List.Row>
  );
}

function SubjectNotes({ project }: { project: ProjectId }) {
  const { t, date } = useI18n();
  const state = useInfiniteQuery(paginatedNotesOptions(project));
  const items = state.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <ContentSection title={t('Notes')} state={state} empty={!items.length}>
      {items.map((item) => (
        <ContentRow
          key={String(item.id)}
          title={item.title}
          icon={<MessagesSquare aria-hidden="true" />}
          updated={date(item.updatedAt, { dateStyle: 'medium' })}
          render={
            <Link
              to="/notes/$noteId"
              params={{ noteId: item.id }}
              search={{ project: String(project) }}
            />
          }
        />
      ))}
    </ContentSection>
  );
}

function SubjectPages({ project }: { project: ProjectId }) {
  const { t, date } = useI18n();
  const state = useInfiniteQuery(pagesOptions(project));
  const items = state.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <ContentSection title={t('SourcePage')} state={state} empty={!items.length}>
      {items.map((item) => (
        <ContentRow
          key={String(item.id)}
          title={item.title}
          icon={<FileText aria-hidden="true" />}
          updated={date(item.updatedAt, { dateStyle: 'medium' })}
          render={
            <Link
              to="/pages/$pageId"
              params={{ pageId: String(item.id) }}
              search={{ project: String(project) }}
            />
          }
        />
      ))}
    </ContentSection>
  );
}

function SubjectSources({ project }: { project: ProjectId }) {
  const { t, date } = useI18n();
  const state = useQuery(subjectSourcesOptions(project));
  const items = state.data ?? [];

  return (
    <ContentSection title={t('MediaList')} state={state} empty={!items.length}>
      {items.map((item) => (
        <ContentRow
          key={String(item.id)}
          title={item.name}
          icon={<Files aria-hidden="true" />}
          updated={date(item.createdAt, { dateStyle: 'medium' })}
          render={
            <Link
              to="/sources/$sourceId"
              params={{ sourceId: String(item.id) }}
              search={{ project: String(project) }}
            />
          }
        />
      ))}
    </ContentSection>
  );
}

function SubjectMaterials({ project }: { project: ProjectId }) {
  const { t, date } = useI18n();
  const state = useInfiniteQuery(materialsOptions(project));
  const items = state.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <ContentSection title={t('SubjectWorkspaceMaterial')} state={state} empty={!items.length}>
      {items.map((item) => (
        <ContentRow
          key={String(item.id)}
          title={item.title}
          icon={<Sparkles aria-hidden="true" />}
          updated={date(item.updated_at, { dateStyle: 'medium' })}
          render={
            <Link
              to="/materials/$materialId"
              params={{ materialId: String(item.id) }}
              search={{ project: String(project) }}
            />
          }
        />
      ))}
    </ContentSection>
  );
}
