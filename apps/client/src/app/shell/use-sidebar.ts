import { projectIdSchema } from '@study/contracts';
import type { ProjectId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Option, Schema } from 'effect';
import { useContext, useState } from 'react';

import { ReplayContext } from '#client/features/onboarding/index.tsx';
import type { PageMetadata } from '#client/lib/navigation/route-contract.ts';
import {
  sidebarContent,
  sidebarSubjectDestination
} from '#client/lib/navigation/sidebar-config.ts';
import type { Notes, Subjects } from '#client/lib/study-client/types.ts';

import { useSidebarActions } from './sidebar-actions.queries';
import { useSidebarContext } from './sidebar-context.queries';
import { useSidebarSearch, useSidebarSearchInput } from './use-sidebar-search.queries';

const noSubjects: Subjects = [];

const noNotes: Notes = [];

export type SidebarProps = {
  metadata: PageMetadata;
  collapsed: boolean;
  onToggle: () => void;
};

/** Composes route context, scoped lists, search, and navigation without feature-specific branches. */
export function useSidebar({ metadata, collapsed, onToggle }: SidebarProps) {
  const replay = useContext(ReplayContext);
  const context = useSidebarContext(metadata);
  const { requestedProject, ready } = context;
  const global = metadata.scope === 'global';
  const section = metadata.section;
  const requestedId = decodeProject(requestedProject);
  const subjectList = useSidebarSubjects(requestedId);
  const { subjects } = subjectList;
  const noteList = useSidebarNoteList(global, requestedProject, requestedId);
  const subjectState = ready ? subjectList.state : loadingState(context.status);
  const noteState = loadingState(listStatus(noteList.query));
  const [settingsProject, setSettingsProject] = useState<ProjectId>();
  const [query, setQuery] = useState('');
  const {
    subject,
    project,
    invalidSubject,
    canSearch: scopeCanSearch
  } = sidebarScope(subjects, requestedProject, global, subjectState);
  const canSearch = ready && scopeCanSearch;
  const { result, hits } = useSidebarSearch({
    query,
    global,
    project,
    canSearch,
    content: sidebarContent(metadata)
  });
  const visibleNotes = ready
    ? sidebarNotes(noteList.query.data?.items ?? noNotes, invalidSubject, requestedProject, project)
    : noNotes;

  const { searchRef, openSearch } = useSidebarSearchInput(collapsed, onToggle);

  const clearSearch = () => {
    setQuery('');
  };
  const {
    pickerOpen,
    setPickerOpen,
    newSubjectOpen,
    setNewSubjectOpen,
    name,
    setName,
    actionError,
    setActionError,
    creating,
    selectSubject,
    createNote,
    createSubject
  } = useSidebarActions(project, sidebarSubjectDestination(metadata, context.owned), clearSearch);

  return {
    replay,
    projectsNext: subjectList.hasNext,
    projectsPrevious: subjectList.hasPrevious,
    loadMoreProjects: subjectList.next,
    previousProjects: subjectList.previous,
    notesNext: noteList.hasNext,
    notesPrevious: noteList.hasPrevious,
    loadMoreNotes: noteList.next,
    previousNotes: noteList.previous,
    settingsProject,
    setSettingsProject,
    metadata,
    collapsed,
    onToggle,
    requestedProject,
    global,
    section,
    subjects,
    subject,
    subjectState,
    project,
    invalidSubject,
    notes: visibleNotes,
    noteState,
    pickerOpen,
    setPickerOpen,
    query,
    setQuery,
    newSubjectOpen,
    setNewSubjectOpen,
    name,
    setName,
    actionError,
    setActionError,
    creating,
    searchRef,
    canSearch,
    result,
    hits,
    openSearch,
    clearSearch,
    selectSubject,
    createNote,
    createSubject,
    reloadSubjects: () => {
      context.reload();
      subjectList.reload();
    },
    reloadNotes: () => {
      void noteList.query.refetch();
    }
  };
}

export type SidebarModel = ReturnType<typeof useSidebar>;

function loadingState(status: 'success' | 'pending' | 'error') {
  if (status === 'success') return 'ready' as const;

  if (status === 'pending') return 'loading' as const;

  return 'error' as const;
}

function sidebarScope(
  subjects: Subjects,
  requestedProject: string | null,
  global: boolean,
  subjectState: ReturnType<typeof loadingState>
) {
  const subject = subjects.find((item) => String(item.id) === requestedProject);
  const project = subjectState === 'ready' ? subject?.id : undefined;
  const invalidSubject =
    !global && Boolean(requestedProject) && subjectState === 'ready' && !subject;
  const canSearch = global || !requestedProject || Boolean(project);

  return { subject, project, invalidSubject, canSearch };
}

function sidebarNotes(
  notes: Notes,
  invalid: boolean,
  requested: string | null,
  project: ProjectId | undefined
) {
  if (invalid) return [];

  return requested
    ? notes.filter((note) => project !== undefined && note.projectIds.includes(project))
    : notes;
}

function decodeProject(requested: string | null) {
  return Schema.decodeUnknownOption(projectIdSchema)(
    requested && /^[1-9][0-9]*$/.test(requested) ? BigInt(requested) : undefined
  );
}

function listStatus(list: { isError: boolean; isPending: boolean }) {
  if (list.isError) return 'error' as const;

  return list.isPending ? ('pending' as const) : ('success' as const);
}

function useSidebarSubjects(requested: Option.Option<ProjectId>) {
  const [cursors, setCursors] = useState<ProjectId[]>([]);
  const projects = rpc.projects.list.useQuery({ limit: 100, before: cursors.at(-1) });
  const selected = rpc.projects.find.useQuery(
    { id: Option.getOrElse(requested, () => projectIdSchema.make(1n)) },
    { enabled: Option.isSome(requested) }
  );
  const selectedProject = selected.data && Option.getOrUndefined(selected.data);
  const current = projects.data?.items ?? noSubjects;
  const subjects =
    selectedProject && !current.some((item) => item.id === selectedProject.id)
      ? [...current, selectedProject]
      : current;
  const state = projectListState(projects, Option.isSome(requested) ? selected : undefined);
  const next = projects.data?.next;

  return {
    subjects,
    state: loadingState(state),
    hasNext: !!next,
    hasPrevious: cursors.length > 0,
    next: () => {
      if (next) setCursors((value) => [...value, next]);
    },
    previous: () => setCursors((value) => value.slice(0, -1)),
    reload: () => {
      projects.refetch();
      selected.refetch();
    }
  };
}

function projectListState(
  projects: { isError: boolean; isPending: boolean },
  selected: { isError: boolean; isPending: boolean } | undefined
) {
  if (projects.isError || selected?.isError) return 'error' as const;

  if (projects.isPending || selected?.isPending) return 'pending' as const;

  return 'success' as const;
}

type NoteCursor = NonNullable<NonNullable<Parameters<typeof rpc.notes.list.useQuery>[0]>['before']>;

function useSidebarNoteList(
  global: boolean,
  requested: string | null,
  id: Option.Option<ProjectId>
) {
  const scope = global ? 'global' : (requested ?? 'global');
  const [pages, setPages] = useState<{ scope: string; cursors: NoteCursor[] }>({
    scope,
    cursors: []
  });
  const cursors = pages.scope === scope ? pages.cursors : [];
  const query = rpc.notes.list.useQuery({
    limit: 100,
    before: cursors.at(-1),
    project: global ? undefined : Option.getOrUndefined(id)
  });
  const next = query.data?.next;

  return {
    query,
    hasNext: !!next,
    hasPrevious: cursors.length > 0,
    next: () => {
      if (next) setPages({ scope, cursors: [...cursors, next] });
    },
    previous: () => setPages({ scope, cursors: cursors.slice(0, -1) })
  };
}
