import type { ProjectId } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { PageMetadata } from '#web/lib/navigation/route-contract.ts';
import { sidebarContent, sidebarSubjectDestination } from '#web/lib/navigation/sidebar-config.ts';
import type { Sessions, Subjects } from '#web/lib/study-client/operations.ts';
import { projectsQueryOptions, sessionsQueryOptions } from '#web/lib/study-client/study.queries.ts';

import { useSidebarActions } from './sidebar-actions.queries';
import { useSidebarContext } from './sidebar-context.queries';
import { useSidebarSearch, useSidebarSearchInput } from './sidebar-search.queries';

const noSubjects: Subjects = [];

const noSessions: Sessions = [];

export type SidebarProps = {
  metadata: PageMetadata;
  collapsed: boolean;
  onToggle: () => void;
};

/** Composes route context, scoped lists, search, and navigation without feature-specific branches. */
export function useSidebar({ metadata, collapsed, onToggle }: SidebarProps) {
  const context = useSidebarContext(metadata);
  const { requestedProject, ready } = context;
  const global = metadata.scope === 'global';
  const section = metadata.section;
  const projects = useQuery(projectsQueryOptions());
  const sessionList = useQuery(sessionsQueryOptions());
  const subjects = projects.data ?? noSubjects;
  const sessions = sessionList.data ?? noSessions;
  const subjectState = loadingState(!ready ? context.status : projects.status);
  const sessionState = loadingState(sessionList.status);
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
  const visibleSessions = ready
    ? sidebarSessions(sessions, invalidSubject, requestedProject, project)
    : noSessions;

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
    createSession,
    createSubject
  } = useSidebarActions(project, sidebarSubjectDestination(metadata, context.owned), clearSearch);

  return {
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
    sessions: visibleSessions,
    sessionState,
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
    createSession,
    createSubject,
    reloadSubjects: () => {
      context.reload();
      void projects.refetch();
    },
    reloadSessions: () => {
      void sessionList.refetch();
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

function sidebarSessions(
  sessions: Sessions,
  invalid: boolean,
  requested: string | null,
  project: ProjectId | undefined
) {
  if (invalid) return [];

  return requested
    ? sessions.filter((session) => project !== undefined && session.projectIds.includes(project))
    : sessions;
}
