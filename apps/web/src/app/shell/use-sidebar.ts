import type { ProjectId } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';
import { useContext, useState } from 'react';

import { ReplayContext } from '#web/features/onboarding/index.tsx';
import type { PageMetadata } from '#web/lib/navigation/route-contract.ts';
import { sidebarContent, sidebarSubjectDestination } from '#web/lib/navigation/sidebar-config.ts';
import type { Notes, Subjects } from '#web/lib/study-client/operations.ts';
import { projectsQueryOptions, notesQueryOptions } from '#web/lib/study-client/study.queries.ts';

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
  const projects = useQuery(projectsQueryOptions());
  const noteList = useQuery(notesQueryOptions());
  const subjects = projects.data ?? noSubjects;
  const notes = noteList.data ?? noNotes;
  const subjectState = loadingState(!ready ? context.status : projects.status);
  const noteState = loadingState(noteList.status);
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
    ? sidebarNotes(notes, invalidSubject, requestedProject, project)
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
      void projects.refetch();
    },
    reloadNotes: () => {
      void noteList.refetch();
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
