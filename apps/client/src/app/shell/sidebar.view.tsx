import {
  HomeIcon,
  PageIcon,
  QuizIcon,
  NoteIcon,
  LibraryIcon,
  ProjectIcon,
  HelpIcon,
  SearchIcon,
  CreateProjectIcon,
  GeneralSettingsIcon,
  CreateNoteIcon
} from '@study/icons';
import {
  LoadMoreButton,
  Button,
  Dialog,
  DialogPopup,
  DialogFooter,
  DialogHeading,
  ErrorState,
  IconButton,
  Input,
  Loading,
  Sidebar as SidebarUI,
  SidebarSearchResults as SearchResults,
  Spinner
} from '@study/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { NewBlankPage } from '#client/features/pages/index.ts';
import {
  PracticeGenerationAction,
  ArchivedPracticeAction
} from '#client/features/practice/index.ts';
import { SubjectIdentity } from '#client/features/subjects/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { searchResultLocation, searchResultKey } from '#client/lib/navigation/search-results.ts';
import { sidebarContent } from '#client/lib/navigation/sidebar-config.ts';
import { Page as SettingsPage } from '#client/pages/settings/page.tsx';

import { RichSidebarNotes } from './rich-sidebar';
import type { useSidebarCounts } from './sidebar-counts.queries';
import { SidebarNavigation } from './sidebar-navigation.view';
import type { SidebarModel } from './use-sidebar';

type SidebarViewModel = SidebarModel & {
  collection: ReactNode;
  selectedNote?: string | null;
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
    case 'page':
      return { Icon: PageIcon, label: 'SourcePage' as const };
    case 'material':
      return { Icon: QuizIcon, label: 'SearchKindMaterial' as const };
    case 'source':
      return { Icon: LibraryIcon, label: 'SearchKindFile' as const };
    case 'project':
      return { Icon: ProjectIcon, label: 'SearchKindProject' as const };
    default:
      return { Icon: NoteIcon, label: 'SearchKindNote' as const };
  }
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
    <SearchResults
      label={t('Search')}
      pending={canSearch && !result}
      feedback={
        <>
          {canSearch && !result && <Loading layout="sidebar" label={t('Searching')} />}
          <SidebarSearchStatus result={result} empty={hits.length === 0} />
        </>
      }
      items={hits.map((hit) => {
        const { Icon, label } = searchPresentation(hit.kind);

        return {
          key: searchResultKey(hit),
          title: hit.title,
          excerpt: hit.excerpt,
          context: t(label),
          icon: <Icon aria-hidden="true" />,
          render: (
            <Link
              {...searchResultLocation(hit, global ? undefined : project?.toString())}
              onClick={clearSearch}
            />
          )
        };
      })}
    />
  );
}

/** Lists scoped notes with an independent deletion action for each row. */

function SidebarNotes({
  selectedNote,
  project,
  subjects,
  invalidSubject,
  notes,
  noteState,
  reloadNotes,
  notesNext,
  notesPrevious,
  loadMoreNotes,
  previousNotes
}: Pick<
  SidebarModel,
  | 'project'
  | 'subjects'
  | 'invalidSubject'
  | 'notes'
  | 'noteState'
  | 'reloadNotes'
  | 'notesNext'
  | 'notesPrevious'
  | 'loadMoreNotes'
  | 'previousNotes'
> & { selectedNote?: string | null }) {
  const { t } = useI18n();

  return (
    <SidebarUI.Items id="study-sidebar-notes" aria-label={t('Notes')}>
      <SidebarNotesStatus noteState={noteState} reloadNotes={reloadNotes} />
      {noteState === 'ready' && !invalidSubject && (
        <RichSidebarNotes
          project={project}
          selectedNote={selectedNote ?? null}
          subjects={subjects}
          notes={notes}
        />
      )}
      {notesPrevious && (
        <Button variant="ghost-muted" onClick={previousNotes}>
          {t('Back')}
        </Button>
      )}
      {notesNext && (
        <LoadMoreButton variant="ghost-muted" onClick={loadMoreNotes} label={t('LibraryMore')} />
      )}
      {noteState === 'ready' && !invalidSubject && notes.length === 0 && (
        <SidebarUI.Message>{t('DashboardNoNotes')}</SidebarUI.Message>
      )}
    </SidebarUI.Items>
  );
}

/** Keeps the subject settings target stable even if that subject is removed from the sidebar. */

function SidebarHeader(model: SidebarModel) {
  const { collapsed, onToggle, clearSearch, project, settingsProject, setSettingsProject } = model;
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
      <SidebarSubjectPicker {...model} />
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

function SidebarSubjectPicker(model: SidebarModel) {
  const {
    collapsed,
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
    projectsNext,
    projectsPrevious,
    loadMoreProjects,
    previousProjects,
    setSettingsProject,
    replay
  } = model;
  const { t, date } = useI18n();

  return (
    <SidebarUI.Picker
      items={[...subjects]}
      value={subject ?? null}
      getLabel={(item) => item.name}
      getValue={(item) => String(item.id)}
      getIcon={subjectPickerIcon}
      getDescription={(item) => subjectPickerDescription(item, t, date)}
      listLabel={t('SidebarPolishSubjects')}
      onValueChange={(item) => selectSubject(item.id)}
      open={pickerOpen}
      onOpenChange={pickerOpenChange(setPickerOpen, reloadSubjects)}
      collapsed={collapsed}
      label={t('ChooseProject')}
      fallbackIcon={<ProjectIcon aria-hidden="true" />}
      searchLabel={t('FindSubject')}
      empty={projectPickerEmpty(subjectState, subjects.length, t)}
      status={<SidebarProjectStatus subjectState={subjectState} reloadSubjects={reloadSubjects} />}
    >
      <SidebarProjectPages
        projectsPrevious={projectsPrevious}
        previousProjects={previousProjects}
        projectsNext={projectsNext}
        loadMoreProjects={loadMoreProjects}
      />
      <SidebarPickerActions
        subject={subject}
        requestedProject={requestedProject}
        setPickerOpen={setPickerOpen}
        setNewSubjectOpen={setNewSubjectOpen}
        setActionError={setActionError}
        clearSearch={clearSearch}
        replay={replay}
        onEditSubject={() => setSettingsProject(subject?.id)}
      />
    </SidebarUI.Picker>
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
  replay,
  onEditSubject
}: Pick<
  SidebarModel,
  | 'subject'
  | 'requestedProject'
  | 'setPickerOpen'
  | 'setNewSubjectOpen'
  | 'setActionError'
  | 'clearSearch'
  | 'replay'
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
        <CreateProjectIcon aria-hidden="true" />
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
        <ProjectIcon aria-hidden="true" />
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
          <GeneralSettingsIcon aria-hidden="true" />
          {t('SubjectSettings')}
        </Button>
      )}
      <SidebarPickerShortcuts
        requestedProject={requestedProject}
        setPickerOpen={setPickerOpen}
        clearSearch={clearSearch}
        replay={replay}
      />
    </>
  );
}

/** Closes the picker before navigating home or replaying onboarding. */

function SidebarPickerShortcuts({
  requestedProject,
  setPickerOpen,
  clearSearch,
  replay
}: Pick<SidebarModel, 'requestedProject' | 'setPickerOpen' | 'clearSearch' | 'replay'>) {
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
        <HomeIcon aria-hidden="true" />
        {t('Home')}
      </Button>
      <Button
        variant="ghost-muted"
        layout="navigation"
        disabled={!replay}
        onClick={() => {
          setPickerOpen(false);
          clearSearch();
          replay?.();
        }}
      >
        <HelpIcon aria-hidden="true" />
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
  createNote
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
  | 'createNote'
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
      <IconButton
        size="icon"
        variant="ghost-muted"
        label={t('NewProject')}

        onClick={() => {
          setNewSubjectOpen(true);
          setActionError(false);
        }}
      >
        <CreateProjectIcon aria-hidden="true" />
      </IconButton>
      <SidebarCreationControl
        metadata={metadata}
        project={project}
        disabled={invalidSubject || subjectState !== 'ready'}
        creating={creating}
        createNote={createNote}
      />
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
          <DialogHeading title={<> {t('NewProject')} </>} />
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

  return <SidebarNotes {...model} />;
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
        <IconButton
          size="icon"
          variant="ghost-muted"
          label={t('Search')}

          onClick={openSearch}
        >
          <SearchIcon aria-hidden="true" />
        </IconButton>
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

/** Disables quick note creation until subject ownership is ready. */

function SidebarCreateNoteIcon({ creating }: Pick<SidebarModel, 'creating'>) {
  const { t } = useI18n();

  return creating ? <Spinner label={t('Saving')} /> : <CreateNoteIcon aria-hidden="true" />;
}

/** Keep picker icon rendering stable while subject and selection state change. */

function subjectPickerIcon(item: SidebarModel['subjects'][number]) {
  return <SubjectIdentity name={item.name} icon={item.icon} />;
}

function subjectPickerDescription(
  item: SidebarModel['subjects'][number],
  t: ReturnType<typeof useI18n>['t'],
  date: ReturnType<typeof useI18n>['date']
) {
  if (!item.examOn) return undefined;

  return t('SidebarPolishExam', {
    date: date(new Date(`${item.examOn}T12:00:00Z`).getTime() / 1000, {
      dateStyle: 'medium',
      timeZone: 'UTC'
    })
  });
}

function SidebarCreationControl({
  metadata,
  project,
  disabled,
  creating,
  createNote
}: Pick<SidebarModel, 'metadata' | 'project' | 'creating' | 'createNote'> & {
  disabled: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      {metadata.section === 'practice' && (
        <>
          <ArchivedPracticeAction key={String(project)} projectId={project} disabled={disabled} />
          <PracticeGenerationAction projectId={project} disabled={disabled} />
        </>
      )}
      {metadata.section === 'pages' && (
        <NewBlankPage key={String(project)} project={project} compact disabled={disabled} />
      )}
      {metadata.title === 'Notes' && (
        <IconButton
          size="icon"
          variant="ghost-muted"
          label={t('NewNote')}

          disabled={creating}
          onClick={() => void createNote()}
        >
          <SidebarCreateNoteIcon creating={creating} />
        </IconButton>
      )}
    </>
  );
}

function SidebarNotesStatus({
  noteState,
  reloadNotes
}: Pick<SidebarModel, 'noteState' | 'reloadNotes'>) {
  const { t } = useI18n();

  return (
    <>
      {noteState === 'loading' && <Loading layout="sidebar" label={t('LoadingNotes')} />}
      {noteState === 'error' && (
        <ErrorState
          layout="sidebar"
          title={t('NotesLoadError')}
          action={
            <Button variant="ghost-muted" onClick={() => reloadNotes()}>
              {t('NotesLoadError')}
            </Button>
          }
        />
      )}
    </>
  );
}

function SidebarProjectPages({
  projectsPrevious,
  previousProjects,
  projectsNext,
  loadMoreProjects
}: Pick<
  SidebarModel,
  'projectsPrevious' | 'previousProjects' | 'projectsNext' | 'loadMoreProjects'
>) {
  const { t } = useI18n();

  return (
    <>
      {projectsPrevious && (
        <Button variant="ghost-muted" onClick={previousProjects}>
          {t('Back')}
        </Button>
      )}
      {projectsNext && (
        <LoadMoreButton variant="ghost-muted" onClick={loadMoreProjects} label={t('LibraryMore')} />
      )}
    </>
  );
}

function pickerOpenChange(
  setOpen: SidebarModel['setPickerOpen'],
  reload: SidebarModel['reloadSubjects']
) {
  return (open: boolean) => {
    setOpen(open);

    if (open) reload();
  };
}
