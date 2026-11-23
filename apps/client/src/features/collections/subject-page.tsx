import type { PageId, MaterialId, SourceId, NoteId, ProjectId, Project } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import {
  OpenIcon,
  PageIcon,
  SourcesIcon,
  NoteIcon,
  AddIcon,
  GeneralSettingsIcon,
  GenerateIcon
} from '@study/icons';
import {
  RetryButton,
  Button,
  ErrorState,
  List,
  Loading,
  SubjectWorkspace,
  WorkspaceSurface
} from '@study/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';

import {
  useCursorRecovery,
  useCursorWindow,
  CursorWindowActions
} from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { usePageBrowse } from '../pages';
import { SubjectIdentity } from '../subjects';
import { SubjectManagement } from './project-settings';

/** Reads only the explicitly selected subject; a failed identity never exposes global content. */
export function SubjectPage({ project }: { project: ProjectId }) {
  return (
    <WorkspaceSurface.Root variant="flow">
      <WorkspaceSurface.Content>
        <WorkspaceSurface.Body>
          <SubjectSelection project={project} />
        </WorkspaceSurface.Body>
      </WorkspaceSurface.Content>
    </WorkspaceSurface.Root>
  );
}

/** The selected live identity owns pending and failed snapshots within the page. */
function SubjectSelection({ project }: { project: ProjectId }) {
  const state = rpc.projects.get.useQuery({ id: project });
  const { t } = useI18n();

  if (state.isPending)
    return (
      <SubjectWorkspace.Root>
        <Loading label={t('LoadingSubjects')} />
      </SubjectWorkspace.Root>
    );

  if (!state.data || state.isError)
    return (
      <ErrorState
        title={t('SubjectsLoadError')}
        action={<RetryButton onClick={state.retry} label={t('Retry')} />}
      />
    );

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
            <GeneralSettingsIcon aria-hidden="true" />
            {t(managing ? 'SubjectWorkspaceContents' : 'SubjectWorkspaceManage')}
          </Button>
          <Button render={<Link to="/notes" search={search} />}>
            <AddIcon aria-hidden="true" />
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

  refetch: () => unknown;
};

function ContentSection<Cursor>({
  title,
  state,
  empty,
  children,
  navigation,
  next
}: {
  title: string;
  state: ReadState;
  empty: boolean;
  children: ReactNode;
  navigation: ReturnType<typeof useCursorWindow<Cursor>>;
  next: Cursor | null | undefined;
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
      <CursorWindowActions
        {...navigation}
        hasMore={next !== null && next !== undefined}
        pending={state.isFetching}
        more={() => navigation.more(next)}
      />
    </SubjectWorkspace.Section>
  );
}

type SubjectRow = {
  title: string;
  updatedAt: bigint;
  location:
    | { kind: 'note'; id: NoteId }
    | { kind: 'page'; id: PageId }
    | { kind: 'source'; id: SourceId }
    | { kind: 'material'; id: MaterialId };
};

function subjectItemLink(location: SubjectRow['location'], project: ProjectId) {
  const search = { project: String(project) };

  switch (location.kind) {
    case 'note':
      return <Link to="/notes/$noteId" params={{ noteId: location.id }} search={search} />;
    case 'page':
      return (
        <Link
          to="/practice/study-notes/$pageId"
          params={{ pageId: String(location.id) }}
          search={search}
        />
      );
    case 'source':
      return (
        <Link to="/sources/$sourceId" params={{ sourceId: String(location.id) }} search={search} />
      );
    case 'material':
      return (
        <Link
          to="/materials/$materialId"
          params={{ materialId: String(location.id) }}
          search={search}
        />
      );
  }
}

function SubjectRows({
  rows,
  icon,
  project
}: {
  rows: readonly SubjectRow[];
  icon: ReactNode;
  project: ProjectId;
}) {
  const { date } = useI18n();

  return rows.map((row) => (
    <List.Row
      key={`${row.location.kind}:${row.location.id}`}
      render={subjectItemLink(row.location, project)}
    >
      <List.Icon>{icon}</List.Icon>
      <List.Main>
        <List.Title>{row.title}</List.Title>
        <List.Description>{date(row.updatedAt, { dateStyle: 'medium' })}</List.Description>
      </List.Main>
      <List.Meta>
        <OpenIcon size={16} aria-hidden="true" />
      </List.Meta>
    </List.Row>
  ));
}

function SubjectNotes({ project }: { project: ProjectId }) {
  const { t } = useI18n();
  const window = useCursorWindow<NonNullable<Parameters<typeof rpc.notes.list.read>[0]['before']>>(
    String(project)
  );
  const limit = window.limit;
  const state = rpc.notes.list.useQuery({ project, limit, before: window.cursor });

  useCursorRecovery(window, state.error);
  const items = state.data?.items ?? [];

  return (
    <ContentSection
      title={t('Notes')}
      state={state}
      navigation={window}
      next={state.data?.next}
      empty={!items.length}
    >
      <SubjectRows
        project={project}
        icon={<NoteIcon aria-hidden="true" />}
        rows={items.map((item): SubjectRow => ({
          title: item.title,
          updatedAt: item.updatedAt,
          location: { kind: 'note', id: item.id }
        }))}
      />
    </ContentSection>
  );
}

function SubjectPages({ project }: { project: ProjectId }) {
  const { t } = useI18n();
  const { query: state, navigation: window } = usePageBrowse(project);
  const items = state.data?.items ?? [];

  return (
    <ContentSection
      title={t('SourcePage')}
      state={state}
      navigation={window}
      next={state.data?.nextCursor}
      empty={!items.length}
    >
      <SubjectRows
        project={project}
        icon={<PageIcon aria-hidden="true" />}
        rows={items.map((item): SubjectRow => ({
          title: item.title,
          updatedAt: item.updatedAt,
          location: { kind: 'page', id: item.id }
        }))}
      />
    </ContentSection>
  );
}

function SubjectSources({ project }: { project: ProjectId }) {
  const { t } = useI18n();
  const window = useCursorWindow<SourceId>(String(project));
  const limit = window.limit;
  const state = rpc.sources.list.useQuery({ projectId: project, limit, before: window.cursor });

  useCursorRecovery(window, state.error);
  const items = state.data?.items ?? [];

  return (
    <ContentSection
      title={t('MediaList')}
      state={state}
      navigation={window}
      next={state.data?.next}
      empty={!items.length}
    >
      <SubjectRows
        project={project}
        icon={<SourcesIcon aria-hidden="true" />}
        rows={items.map((item): SubjectRow => ({
          title: item.name,
          updatedAt: item.createdAt,
          location: { kind: 'source', id: item.id }
        }))}
      />
    </ContentSection>
  );
}

function SubjectMaterials({ project }: { project: ProjectId }) {
  const { t } = useI18n();
  const window = useCursorWindow<MaterialId>(String(project));
  const limit = window.limit;
  const state = rpc.materials.list.useQuery({
    projectId: project,
    archived: false,
    limit,
    cursor: window.cursor
  });

  useCursorRecovery(window, state.error);
  const items = state.data?.items ?? [];

  return (
    <ContentSection
      title={t('SubjectWorkspaceMaterial')}
      state={state}
      navigation={window}
      next={state.data?.nextCursor}
      empty={!items.length}
    >
      <SubjectRows
        project={project}
        icon={<GenerateIcon aria-hidden="true" />}
        rows={items.map((item): SubjectRow => ({
          title: item.title,
          updatedAt: item.updated_at,
          location: { kind: 'material', id: item.id }
        }))}
      />
    </ContentSection>
  );
}
