import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from '@study/ui/dialog';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Spinner } from '@study/ui/spinner';
import { Link } from '@tanstack/react-router';
import {
  Home,
  FileText,
  GraduationCap,
  MessagesSquare,
  Library,
  Folder,
  CircleHelp,
  Search,
  FolderPlus,
  Settings2,
  SquarePen
} from 'lucide-react';
import type { ReactNode } from 'react';

import { NewBlankDocument } from '#web/features/authored-documents/index.ts';
import { SubjectIdentity } from '#web/features/subjects/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';
import { searchResultLocation, searchResultKey } from '#web/lib/navigation/search-results.ts';
import { sidebarContent } from '#web/lib/navigation/sidebar-config.ts';
import { Page as SettingsPage } from '#web/pages/settings/page.tsx';

import { RichSidebarSessions } from './rich-sidebar';
import type { useSidebarCounts } from './sidebar-counts.queries';
import { SidebarNavigation } from './sidebar-navigation.view';
import type { SidebarModel } from './use-sidebar';

type SidebarViewModel = SidebarModel & {
  collection: ReactNode;
  selectedSession?: string | null;
  counts?: ReturnType<typeof useSidebarCounts>;
};

export function SidebarView(model: SidebarViewModel) {
  const { t } = useI18n();

  return (
    <SidebarUI.Root aria-label={t('SidebarNavigation')}>
      <SidebarHeader {...model} />
      <SidebarToolbar {...model} />
      <SidebarContent {...model} />
      <SidebarNavigation
        counts={model.counts}
        section={model.section}
        settings={model.metadata.title === 'Settings'}
        project={model.requestedProject}
        workspaceProject={model.project}
        onNavigate={model.clearSearch}
      />
      <NewProjectDialog {...model} />
    </SidebarUI.Root>
  );
}

function searchPresentation(kind: SidebarModel['hits'][number]['kind']) {
  switch (kind) {
    case 'document':
      return { Icon: FileText, label: 'SourceDocument' as const };
    case 'material':
      return { Icon: GraduationCap, label: 'SearchKindMaterial' as const };
    case 'source':
      return { Icon: Library, label: 'SearchKindFile' as const };
    case 'project':
      return { Icon: Folder, label: 'SearchKindProject' as const };
    default:
      return { Icon: MessagesSquare, label: 'SearchKindSession' as const };
  }
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
  const { Icon, label } = searchPresentation(hit.kind);

  return (
    <SidebarUI.Item
      label={hit.title}
      icon={<Icon aria-hidden="true" />}
      context={t(label)}
      description={hit.excerpt}
      aria-label={hit.title}
      title={hit.title}
      render={
        <Link
          {...searchResultLocation(hit, global ? undefined : project?.toString())}
          onClick={clearSearch}
        />
      }
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
          key={searchResultKey(hit)}
          global={global}
          project={project}
          clearSearch={clearSearch}
          hit={hit}
        />
      ))}
    </SidebarUI.Items>
  );
}

/** Lists scoped sessions with an independent deletion action for each row. */

function SidebarSessions({
  selectedSession,
  project,
  subjects,
  invalidSubject,
  sessions,
  sessionState,
  reloadSessions
}: Pick<
  SidebarModel,
  'project' | 'subjects' | 'invalidSubject' | 'sessions' | 'sessionState' | 'reloadSessions'
> & { selectedSession?: string | null }) {
  const { t } = useI18n();

  return (
    <SidebarUI.Items id="study-sidebar-sessions" aria-label={t('Sessions')}>
      {sessionState === 'loading' && <Loading layout="sidebar" label={t('LoadingSessions')} />}
      {sessionState === 'error' && (
        <ErrorState
          layout="sidebar"
          title={t('SessionsLoadError')}
          action={
            <Button variant="ghost-muted" onClick={() => reloadSessions()}>
              {t('SessionsLoadError')}
            </Button>
          }
        />
      )}
      {sessionState === 'ready' && !invalidSubject && (
        <RichSidebarSessions
          project={project}
          selectedSession={selectedSession ?? null}
          subjects={subjects}
          sessions={sessions}
        />
      )}
      {sessionState === 'ready' && !invalidSubject && sessions.length === 0 && (
        <SidebarUI.Message>{t('DashboardNoSessions')}</SidebarUI.Message>
      )}
    </SidebarUI.Items>
  );
}

/** Keeps the subject settings target stable even if that subject is removed from the sidebar. */

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
  reloadSubjects,
  project,
  settingsProject,
  setSettingsProject
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
  | 'project'
  | 'settingsProject'
  | 'setSettingsProject'
>) {
  const { t, date } = useI18n();

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
        getIcon={subjectPickerIcon}
        getDescription={(item) =>
          item.examOn
            ? t('SidebarPolishExam', {
                date: date(new Date(`${item.examOn}T12:00:00Z`).getTime() / 1000, {
                  dateStyle: 'medium',
                  timeZone: 'UTC'
                })
              })
            : undefined
        }
        listLabel={t('SidebarPolishSubjects')}
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
        <SidebarPickerActions
          subject={subject}
          requestedProject={requestedProject}
          setPickerOpen={setPickerOpen}
          setNewSubjectOpen={setNewSubjectOpen}
          setActionError={setActionError}
          clearSearch={clearSearch}
          onEditSubject={() => setSettingsProject(subject?.id)}
        />
      </SidebarUI.Picker>
      {settingsProject && (
        <SettingsPage
          initialSection="projects"
          initialProject={settingsProject}
          workspaceProject={project}
          onClose={() => setSettingsProject(undefined)}
        />
      )}
    </SidebarUI.Header>
  );
}

/** Closes the picker before opening subject creation, management, or global navigation. */

function SidebarPickerActions({
  subject,
  requestedProject,
  setPickerOpen,
  setNewSubjectOpen,
  setActionError,
  clearSearch,
  onEditSubject
}: Pick<
  SidebarModel,
  | 'subject'
  | 'requestedProject'
  | 'setPickerOpen'
  | 'setNewSubjectOpen'
  | 'setActionError'
  | 'clearSearch'
> & {
  onEditSubject: () => void;
}) {
  const { t } = useI18n();

  return (
    <>
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
      {subject && (
        <Button
          variant="ghost-muted"
          layout="navigation"
          onClick={() => {
            setPickerOpen(false);
            onEditSubject();
          }}
        >
          <Settings2 aria-hidden="true" />
          {t('SubjectSettings')}
        </Button>
      )}
      <SidebarPickerShortcuts
        requestedProject={requestedProject}
        setPickerOpen={setPickerOpen}
        clearSearch={clearSearch}
      />
    </>
  );
}

/** Closes the picker before navigating to the overview or help destination. */

function SidebarPickerShortcuts({
  requestedProject,
  setPickerOpen,
  clearSearch
}: Pick<SidebarModel, 'requestedProject' | 'setPickerOpen' | 'clearSearch'>) {
  const { t } = useI18n();

  return (
    <SidebarUI.PickerShortcuts>
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
    </SidebarUI.PickerShortcuts>
  );
}

function SidebarToolbar({
  metadata,
  invalidSubject,
  subjectState,
  collapsed,
  global,
  project,
  query,
  setQuery,
  setNewSubjectOpen,
  setActionError,
  creating,
  searchRef,
  openSearch,
  clearSearch,
  createSession
}: Pick<
  SidebarModel,
  | 'metadata'
  | 'invalidSubject'
  | 'subjectState'
  | 'collapsed'
  | 'global'
  | 'project'
  | 'query'
  | 'setQuery'
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
      {metadata.section === 'documents' && (
        <NewBlankDocument
          key={String(project)}
          project={project}
          compact
          disabled={invalidSubject || subjectState !== 'ready'}
        />
      )}
      {metadata.title === 'Sessions' && (
        <Button
          size="icon"
          variant="ghost-muted"
          aria-label={t('NewSession')}
          title={t('NewSession')}
          disabled={creating}
          onClick={() => void createSession()}
        >
          <SidebarCreateSessionIcon creating={creating} />
        </Button>
      )}
    </SidebarUI.Toolbar>
  );
}

function SidebarContent(model: SidebarViewModel) {
  const { invalidSubject, subjectState, pickerOpen, reloadSubjects, actionError, newSubjectOpen } =
    model;
  const { t } = useI18n();

  return (
    <SidebarUI.Content>
      {invalidSubject && (
        <SidebarUI.Message role="status">{t('SubjectNotFound')}</SidebarUI.Message>
      )}
      {subjectState === 'error' && !pickerOpen && (
        <ErrorState
          layout="sidebar"
          title={t('SubjectsLoadError')}
          action={
            <Button variant="ghost-muted" onClick={() => reloadSubjects()}>
              {t('SubjectsLoadError')}
            </Button>
          }
        />
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
        <ErrorState
          layout="sidebar"
          title={t('SubjectsLoadError')}
          action={
            <Button variant="ghost-muted" layout="navigation" onClick={() => reloadSubjects()}>
              {t('SubjectsLoadError')}
            </Button>
          }
        />
      ) : null}
    </>
  );
}

function projectPickerEmpty(
  state: SidebarModel['subjectState'],
  count: number,
  t: ReturnType<typeof useI18n>['t']
) {
  if (state !== 'ready') return null;

  return t(count === 0 ? 'NoProjectsYet' : 'SearchNoResults');
}

function SidebarContentBody(model: SidebarViewModel) {
  if (sidebarContent(model.metadata) !== 'workspace') return model.collection;

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

/** Disables quick session creation until subject ownership is ready. */

function SidebarCreateSessionIcon({ creating }: Pick<SidebarModel, 'creating'>) {
  const { t } = useI18n();

  return creating ? <Spinner label={t('Saving')} /> : <SquarePen aria-hidden="true" />;
}

/** Keep picker icon rendering stable while subject and selection state change. */

function subjectPickerIcon(item: SidebarModel['subjects'][number]) {
  return <SubjectIdentity name={item.name} icon={item.icon} />;
}
