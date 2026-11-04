import type { ProjectId } from '@study/contracts/ids';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import type { ItemFilter } from '#web/features/library/index.ts';
import { sessionOptions } from '#web/features/session-workspace/index.ts';
import type { PageMetadata } from '#web/lib/navigation/route-contract.ts';
import type { Sessions, Subjects } from '#web/lib/study-client/operations.ts';
import {
  createProjectMutationOptions,
  createSessionMutationOptions,
  projectsQueryOptions,
  sessionsQueryOptions,
  searchQueryOptions
} from '#web/lib/study-client/study.queries.ts';

import { filterSearchHits } from './sidebar.logic';

const noSubjects: Subjects = [];

const noSessions: Sessions = [];

export type SidebarProps = {
  metadata: PageMetadata;
  collapsed: boolean;
  onToggle: () => void;
};

/** Combines resolved session ownership, subject lists, search and sidebar actions. */
export function useSidebar({ metadata, collapsed, onToggle }: SidebarProps) {
  const { selectedSession, requestedProject, sessionReady, ownershipStatus, reloadOwner } =
    useSidebarOwnership(metadata);
  const global = metadata.scope === 'global';
  const section = metadata.section;
  const projects = useQuery(projectsQueryOptions());
  const sessionList = useQuery(sessionsQueryOptions());
  const subjects = projects.data ?? noSubjects;
  const sessions = sessionList.data ?? noSessions;
  const subjectState = loadingState(
    selectedSession && !sessionReady ? ownershipStatus : projects.status
  );
  const sessionState = loadingState(sessionList.status);
  const [settingsProject, setSettingsProject] = useState<ProjectId>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ItemFilter>('all');
  const {
    subject,
    project,
    invalidSubject,
    canSearch: scopeCanSearch
  } = sidebarScope(subjects, requestedProject, global, subjectState);
  const canSearch = sessionReady && scopeCanSearch;
  const { result, hits } = useSidebarSearch({ query, global, project, canSearch, section, filter });
  const visibleSessions = sessionReady
    ? sidebarSessions(sessions, invalidSubject, requestedProject, project)
    : noSessions;

  const { searchRef, openSearch } = useSidebarSearchInput(collapsed, onToggle);

  const clearSearch = () => {
    setQuery('');
    setFilter('all');
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
  } = useSidebarActions(project, global, clearSearch);

  return {
    settingsProject,
    setSettingsProject,
    metadata,
    collapsed,
    onToggle,
    requestedProject,
    selectedSession,
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
    filter,
    setFilter,
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
      reloadOwner();
      void projects.refetch();
    },
    reloadSessions: () => {
      void sessionList.refetch();
    }
  };
}

/** Uses session membership as the authority, preferring the requested subject only when it belongs to that session. */
function useSidebarOwnership(metadata: PageMetadata) {
  const search = useSearch({ from: '__root__' });
  const params = useParams({ strict: false });
  const selectedSession =
    metadata.title === 'Sessions' && params.sessionId ? String(params.sessionId) : null;
  const selectedDetail = useQuery({
    ...sessionOptions(params.sessionId!),
    enabled: selectedSession !== null
  });
  const sessionReady = !selectedSession || selectedDetail.isSuccess;
  const requestedProject = selectedSession
    ? String(
        selectedDetail.data?.projectIds.find((id) => String(id) === search.project) ??
          selectedDetail.data?.projectIds[0] ??
          ''
      ) || null
    : (search.project ?? null);

  return {
    selectedSession,
    requestedProject,
    sessionReady,
    ownershipStatus: selectedDetail.status,
    reloadOwner: () => {
      if (selectedSession) void selectedDetail.refetch();
    }
  };
}

export type SidebarModel = ReturnType<typeof useSidebar>;

function useSidebarSearch({
  query,
  global,
  project,
  canSearch,
  section,
  filter
}: {
  query: string;
  global: boolean;
  project: ProjectId | undefined;
  canSearch: boolean;
  section: PageMetadata['section'];
  filter: ItemFilter;
}) {
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 200);

    return () => clearTimeout(timer);
  }, [query]);
  const searchEnabled =
    Boolean(query.trim()) &&
    query.trim() === debouncedQuery &&
    canSearch &&
    (section === 'sessions' || section === 'pipelines');
  const searchResult = useQuery(
    searchQueryOptions(
      {
        query: query.trim(),
        project: global ? undefined : project,
        limit: 30,
        ...(global ? {} : { kinds: ['session', 'message'] })
      },
      searchEnabled
    )
  );
  const result = searchResultState(searchEnabled, searchResult);
  const hits = filterSearchHits(result?.result?.hits ?? [], filter);

  return { result, hits };
}

function useSidebarSearchInput(collapsed: boolean, onToggle: () => void) {
  const searchRef = useRef<HTMLInputElement>(null);
  const openSearch = () => {
    if (collapsed) onToggle();

    requestAnimationFrame(() => searchRef.current?.focus());
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();

        if (collapsed) onToggle();

        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [collapsed, onToggle]);

  return { searchRef, openSearch };
}

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

function searchResultState<T>(
  enabled: boolean,
  state: { isSuccess: boolean; isError: boolean; data: T }
) {
  if (!enabled) return undefined;

  if (state.isSuccess) return { result: state.data!, error: false };

  if (state.isError) return { result: undefined, error: true };

  return undefined;
}

function useSidebarActions(
  project: ProjectId | undefined,
  global: boolean,
  clearSearch: () => void
) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newSubjectOpen, setNewSubjectOpen] = useState(false);
  const [name, setName] = useState('');
  const [actionError, setActionError] = useState(false);
  const subjectMutation = useMutation(createProjectMutationOptions(queryClient));
  const sessionMutation = useMutation(createSessionMutationOptions(queryClient));
  const creating = subjectMutation.isPending || sessionMutation.isPending;
  const selectSubject = (id: ProjectId) => {
    setPickerOpen(false);
    clearSearch();

    if (global) {
      void navigate({ to: '/library', search: { project: String(id) } });
    } else if (params.sessionId) {
      void navigate({ to: '/sessions', search: { project: String(id) } });
    } else {
      void navigate({ to: '.', search: { project: String(id) } });
    }
  };
  const createSession = () => {
    if (creating) return;

    setActionError(false);
    sessionMutation.mutate(project, {
      onError: () => setActionError(true),
      onSuccess: (created) => {
        clearSearch();
        void navigate({
          to: '/sessions/$sessionId',
          params: { sessionId: created.id },
          search: project ? { project: String(project) } : {}
        });
      }
    });
  };
  const createSubject = () => {
    if (!name.trim() || creating) return;

    setActionError(false);
    subjectMutation.mutate(name.trim(), {
      onError: () => setActionError(true),
      onSuccess: (created) => {
        setNewSubjectOpen(false);
        setName('');
        selectSubject(created.id);
      }
    });
  };

  return {
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
  };
}
