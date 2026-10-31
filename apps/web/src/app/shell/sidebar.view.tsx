import { age } from '@study/localization';
import { Button } from '@study/ui/button';
import { useNowMinute } from '@study/ui/clock';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from '@study/ui/dialog';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { Menu, MenuTrigger, MenuPopup, MenuItem } from '@study/ui/menu';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Spinner } from '@study/ui/spinner';
import { Link } from '@tanstack/react-router';
import {
  Home,
  MessagesSquare,
  Library,
  Folder,
  CircleHelp,
  Search,
  ListFilter,
  FolderPlus,
  SquarePen,
  Check
} from 'lucide-react';
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';
import { SidebarNavigation } from './sidebar-navigation.view';
import { resultLocation } from './sidebar.locations';
import type { SidebarModel } from './use-sidebar';

export function SidebarView(model: SidebarModel & { library: ReactNode }) {
  const { t } = useI18n();

  return (
    <SidebarUI.Root aria-label={t('SidebarNavigation')}>
      <SidebarHeader {...model} />
      <SidebarToolbar {...model} />
      <SidebarContent {...model} />
      <SidebarNavigation
        section={model.section}
        settings={model.metadata.title === 'Settings'}
        project={model.requestedProject}
        onNavigate={model.clearSearch}
      />
      <NewProjectDialog {...model} />
    </SidebarUI.Root>
  );
}

function SidebarSearchHit({
  global,
  project,
  clearSearch,
  hit
}: Pick<SidebarModel, 'global' | 'project' | 'clearSearch'> & {
  hit: SidebarModel['hits'][number];
}) {
  const { t } = useI18n();

  return (
    <SidebarUI.Item
      label={hit.title}
      icon={
        hit.kind === 'source' ? (
          <Library aria-hidden="true" />
        ) : hit.kind === 'project' ? (
          <Folder aria-hidden="true" />
        ) : (
          <MessagesSquare aria-hidden="true" />
        )
      }
      context={t(
        hit.kind === 'source'
          ? 'SearchKindFile'
          : hit.kind === 'project'
            ? 'SearchKindProject'
            : 'SearchKindSession'
      )}
      description={hit.excerpt}
      aria-label={hit.title}
      title={hit.title}
      render={<Link {...resultLocation(hit, global ? undefined : project)} onClick={clearSearch} />}
    />
  );
}

function SidebarSearchResults({
  global,
  project,
  canSearch,
  result,
  hits,
  clearSearch
}: Pick<SidebarModel, 'global' | 'project' | 'canSearch' | 'result' | 'hits' | 'clearSearch'>) {
  const { t } = useI18n();

  return (
    <SidebarUI.Items aria-label={t('Search')} aria-busy={canSearch && !result}>
      {canSearch && !result && <Loading layout="sidebar" label={t('Searching')} />}
      <SidebarSearchStatus result={result} empty={hits.length === 0} />
      {hits.map((hit) => (
        <SidebarSearchHit
          key={searchHitKey(hit)}
          global={global}
          project={project}
          clearSearch={clearSearch}
          hit={hit}
        />
      ))}
    </SidebarUI.Items>
  );
}

function SidebarSessions({
  selectedSession,
  subjects,
  invalidSubject,
  sessions,
  sessionState,
  reloadSessions
}: Pick<
  SidebarModel,
  'selectedSession' | 'subjects' | 'invalidSubject' | 'sessions' | 'sessionState' | 'reloadSessions'
>) {
  const { t, locale, date } = useI18n();
  const now = useNowMinute();

  return (
    <SidebarUI.Items id="study-sidebar-sessions" aria-label={t('Sessions')}>
      {sessionState === 'loading' && <Loading layout="sidebar" label={t('LoadingSessions')} />}
      {sessionState === 'error' && (
        <Button variant="ghost-muted" onClick={() => reloadSessions()}>
          {t('SessionsLoadError')}
        </Button>
      )}
      {sessionState === 'ready' &&
        !invalidSubject &&
        sessions.map((session) => {
          const owner = subjects.find((item) => item.id === session.projectId);

          return (
            <SidebarUI.Item
              key={String(session.id)}
              label={session.title}
              icon={<MessagesSquare aria-hidden="true" />}
              context={owner?.name ?? t('Sessions')}
              description={t('SearchKindSession')}
              timestamp={
                <time
                  dateTime={new Date(Number(session.updatedAt) * 1000).toISOString()}
                  title={date(session.updatedAt)}
                >
                  {age(locale, now - Number(session.updatedAt))}
                </time>
              }
              aria-label={session.title}
              aria-current={selectedSession === String(session.id) ? 'page' : undefined}
              title={session.title}
              render={
                <Link
                  to="/sessions"
                  search={{ project: String(session.projectId), id: String(session.id) }}
                />
              }
            />
          );
        })}
      {sessionState === 'ready' && !invalidSubject && sessions.length === 0 && (
        <SidebarUI.Message>{t('DashboardNoSessions')}</SidebarUI.Message>
      )}
    </SidebarUI.Items>
  );
}

function SidebarHeader({
  collapsed,
  onToggle,
  requestedProject,
  subjects,
  subject,
  subjectState,
  pickerOpen,
  setPickerOpen,
  setNewSubjectOpen,
  setActionError,
  clearSearch,
  selectSubject,
  reloadSubjects
}: Pick<
  SidebarModel,
  | 'collapsed'
  | 'onToggle'
  | 'requestedProject'
  | 'subjects'
  | 'subject'
  | 'subjectState'
  | 'pickerOpen'
  | 'setPickerOpen'
  | 'setNewSubjectOpen'
  | 'setActionError'
  | 'clearSearch'
  | 'selectSubject'
  | 'reloadSubjects'
>) {
  const { t } = useI18n();

  return (
    <SidebarUI.Header>
      <SidebarUI.Toggle
        label={t('ToggleSidebar')}
        expanded={!collapsed}
        aria-controls="study-sidebar-navigation"
        onClick={() => {
          clearSearch();
          onToggle();
        }}
      />
      <SidebarUI.Picker
        items={subjects}
        value={subject ?? null}
        getLabel={(item) => item.name}
        getValue={(item) => String(item.id)}
        onValueChange={(item) => selectSubject(item.id)}
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);

          if (open) reloadSubjects();
        }}
        collapsed={collapsed}
        label={t('ChooseProject')}
        fallbackIcon={<Folder aria-hidden="true" />}
        searchLabel={t('FindSubject')}
        empty={projectPickerEmpty(subjectState, subjects.length, t)}
        status={
          <SidebarProjectStatus subjectState={subjectState} reloadSubjects={reloadSubjects} />
        }
      >
        <Button
          variant="ghost-muted"
          layout="navigation"
          render={
            <Link
              to="/home"
              search={requestedProject ? { project: requestedProject } : {}}
              onClick={() => {
                setPickerOpen(false);
                clearSearch();
              }}
            />
          }
        >
          <Home aria-hidden="true" />
          {t('Home')}
        </Button>
        <Button
          variant="ghost-muted"
          layout="navigation"
          onClick={() => {
            setPickerOpen(false);
            setNewSubjectOpen(true);
            setActionError(false);
          }}
        >
          <FolderPlus aria-hidden="true" />
          {t('NewProject')}
        </Button>
        <Button
          variant="ghost-muted"
          layout="navigation"
          render={
            <Link
              to="/projects"
              search={{}}
              onClick={() => {
                setPickerOpen(false);
                clearSearch();
              }}
            />
          }
        >
          <Folder aria-hidden="true" />
          {t('Projects')}
        </Button>
        <Button
          variant="ghost-muted"
          layout="navigation"
          render={
            <Link
              to="/help"
              search={requestedProject ? { project: requestedProject } : {}}
              onClick={() => {
                setPickerOpen(false);
                clearSearch();
              }}
            />
          }
        >
          <CircleHelp aria-hidden="true" />
          {t('Help')}
        </Button>
      </SidebarUI.Picker>
    </SidebarUI.Header>
  );
}

function SidebarToolbar({
  collapsed,
  global,
  section,
  project,
  query,
  setQuery,
  filter,
  setFilter,
  setNewSubjectOpen,
  setActionError,
  creating,
  searchRef,
  openSearch,
  clearSearch,
  createSession
}: Pick<
  SidebarModel,
  | 'collapsed'
  | 'global'
  | 'section'
  | 'project'
  | 'query'
  | 'setQuery'
  | 'filter'
  | 'setFilter'
  | 'setNewSubjectOpen'
  | 'setActionError'
  | 'creating'
  | 'searchRef'
  | 'openSearch'
  | 'clearSearch'
  | 'createSession'
>) {
  const { t } = useI18n();

  return (
    <SidebarUI.Toolbar>
      <SidebarSearchControl
        collapsed={collapsed}
        openSearch={openSearch}
        searchRef={searchRef}
        global={global}
        project={project}
        query={query}
        setQuery={setQuery}
        clearSearch={clearSearch}
      />
      <Menu>
        <MenuTrigger
          render={<Button size="icon" variant={filter === 'all' ? 'ghost-muted' : 'secondary'} />}
          aria-label={t('SearchFilter')}
          title={t('SearchFilter')}
        >
          <ListFilter aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="start">
          {sidebarFilterKinds(section).map((kind) => (
            <MenuItem key={kind} onClick={() => setFilter(kind)}>
              {t(filterLabel(kind))}
              {filter === kind && <Check aria-hidden="true" />}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
      <Button
        size="icon"
        variant="ghost-muted"
        aria-label={t('NewProject')}
        title={t('NewProject')}
        onClick={() => {
          setNewSubjectOpen(true);
          setActionError(false);
        }}
      >
        <FolderPlus aria-hidden="true" />
      </Button>
      <Button
        size="icon"
        variant="ghost-muted"
        aria-label={t('NewSession')}
        title={t(project ? 'NewSession' : 'ChooseProject')}
        disabled={!project || creating}
        onClick={() => void createSession()}
      >
        <SidebarCreateSessionIcon creating={creating} />
      </Button>
    </SidebarUI.Toolbar>
  );
}

function SidebarContent(model: SidebarModel & { library: ReactNode }) {
  const { invalidSubject, subjectState, pickerOpen, reloadSubjects, actionError, newSubjectOpen } =
    model;
  const { t } = useI18n();

  return (
    <SidebarUI.Content>
      {invalidSubject && (
        <SidebarUI.Message role="status">{t('SubjectNotFound')}</SidebarUI.Message>
      )}
      {subjectState === 'error' && !pickerOpen && (
        <Button variant="ghost-muted" onClick={() => reloadSubjects()}>
          {t('SubjectsLoadError')}
        </Button>
      )}
      {actionError && !newSubjectOpen && (
        <SidebarUI.Message role="alert">{t('ActionError')}</SidebarUI.Message>
      )}
      <SidebarContentBody {...model} />
    </SidebarUI.Content>
  );
}

function NewProjectDialog({
  newSubjectOpen,
  setNewSubjectOpen,
  name,
  setName,
  actionError,
  creating,
  createSubject
}: Pick<
  SidebarModel,
  | 'newSubjectOpen'
  | 'setNewSubjectOpen'
  | 'name'
  | 'setName'
  | 'actionError'
  | 'creating'
  | 'createSubject'
>) {
  const { t } = useI18n();

  return (
    <Dialog open={newSubjectOpen} onOpenChange={setNewSubjectOpen}>
      <DialogPopup closeLabel={t('Close')}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createSubject();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('NewProject')}</DialogTitle>
          </DialogHeader>
          <SidebarUI.FormFields>
            <label htmlFor="study-subject-name">{t('ProjectName')}</label>
            <Input
              id="study-subject-name"
              value={name}
              onValueChange={setName}
              maxLength={100}
              required
            />
            {actionError && (
              <SidebarUI.Message role="alert">{t('ProjectsSaveError')}</SidebarUI.Message>
            )}
          </SidebarUI.FormFields>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewSubjectOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || creating}>
              {creating ? <Loading label={t('Saving')} /> : t('CreateProject')}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function filterLabel(kind: SidebarModel['filter']) {
  switch (kind) {
    case 'all':
      return 'FilterAll';
    case 'session':
      return 'Sessions';
    case 'source':
      return 'MediaList';
    case 'diagram':
      return 'Diagrams';
    case 'flashcards':
      return 'Flashcards';
    default:
      return 'SidebarQuiz';
  }
}

function searchHitKey(hit: SidebarModel['hits'][number]) {
  const target = hit.target;
  const id =
    target.type === 'project'
      ? target.id
      : target.type === 'session'
        ? target.sessionId
        : target.type === 'source'
          ? target.sourceId
          : target.materialId;

  return `${target.type}:${id}:${hit.at}:${hit.excerpt ?? ''}`;
}

function SidebarSearchStatus({ result, empty }: Pick<SidebarModel, 'result'> & { empty: boolean }) {
  const { t } = useI18n();

  return (
    <>
      {' '}
      {result?.error && <SidebarUI.Message role="alert">{t('SearchFailed')}</SidebarUI.Message>}
      {keywordOnly(result) && <SidebarUI.Message>{t('SearchKeywordOnly')}</SidebarUI.Message>}
      {hasEmptyResults(result, empty) && (
        <SidebarUI.Message role="status">{t('SearchNoResults')}</SidebarUI.Message>
      )}
    </>
  );
}

function SidebarProjectStatus({
  subjectState,
  reloadSubjects
}: Pick<SidebarModel, 'subjectState' | 'reloadSubjects'>) {
  const { t } = useI18n();

  return (
    <>
      {subjectState === 'loading' ? (
        <Loading layout="sidebar" label={t('LoadingSubjects')} />
      ) : subjectState === 'error' ? (
        <Button variant="ghost-muted" layout="navigation" onClick={() => reloadSubjects()}>
          {t('SubjectsLoadError')}
        </Button>
      ) : null}
    </>
  );
}

function sidebarFilterKinds(section: SidebarModel['section']) {
  if (section === 'library') return ['all', 'source', 'diagram'] as const;

  if (section === 'practice') return ['all', 'flashcards', 'quiz'] as const;

  return ['all', 'session'] as const;
}

function projectPickerEmpty(
  state: SidebarModel['subjectState'],
  count: number,
  t: ReturnType<typeof useI18n>['t']
) {
  if (state !== 'ready') return null;

  return t(count === 0 ? 'NoProjectsYet' : 'SearchNoResults');
}

function SidebarContentBody(model: SidebarModel & { library: ReactNode }) {
  if (model.section === 'library' || model.section === 'practice') return model.library;

  if (model.query.trim()) return <SidebarSearchResults {...model} />;

  return <SidebarSessions {...model} />;
}

function keywordOnly(result: SidebarModel['result']) {
  return !!result?.result && !result.result.semantic;
}

function hasEmptyResults(result: SidebarModel['result'], empty: boolean) {
  return !!result?.result && empty;
}

function SidebarSearchControl({
  collapsed,
  openSearch,
  searchRef,
  global,
  project,
  query,
  setQuery,
  clearSearch
}: Pick<
  SidebarModel,
  | 'collapsed'
  | 'openSearch'
  | 'searchRef'
  | 'global'
  | 'project'
  | 'query'
  | 'setQuery'
  | 'clearSearch'
>) {
  const { t } = useI18n();

  return (
    <>
      {' '}
      {collapsed ? (
        <Button
          size="icon"
          variant="ghost-muted"
          aria-label={t('Search')}
          title={t('Search')}
          onClick={openSearch}
        >
          <Search aria-hidden="true" />
        </Button>
      ) : (
        <SidebarUI.Search
          ref={searchRef}
          aria-label={t(!global && project ? 'SearchThisSubject' : 'Search')}
          placeholder={t('Search')}
          value={query}
          onValueChange={setQuery}
          clearLabel={t('SearchClose')}
          onClear={clearSearch}
          onKeyDown={(event) => {
            if (event.key === 'Escape') clearSearch();
          }}
        />
      )}
    </>
  );
}

function SidebarCreateSessionIcon({ creating }: Pick<SidebarModel, 'creating'>) {
  const { t } = useI18n();

  return creating ? <Spinner label={t('Saving')} /> : <SquarePen aria-hidden="true" />;
}
