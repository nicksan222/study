import type { ProjectId } from '@study/contracts/ids';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import type { ItemFilter } from '../../features/library';
import type { PageMetadata } from '../../lib/navigation/route-contract';
import type { Sessions, Subjects } from '../../lib/study-client/operations';
import {
  createProjectMutationOptions,
  createSessionMutationOptions,
  projectsQueryOptions,
  sessionsQueryOptions,
  searchQueryOptions
} from '../../lib/study-client/study.queries';
import { filterSearchHits } from './sidebar.logic';

const noSubjects: Subjects = [];

const noSessions: Sessions = [];

export type SidebarProps = {
  metadata: PageMetadata;
  collapsed: boolean;
  onToggle: () => void;
};

export function useSidebar({ metadata, collapsed, onToggle }: SidebarProps) {
  const search = useSearch({ from: '__root__' });
  const requestedProject = search.project ?? null;
  const selectedSession = metadata.title === 'Sessions' ? (search.id ?? null) : null;
  const global = metadata.scope === 'global';
  const section = metadata.section;
  const projects = useQuery(projectsQueryOptions());
  const sessionList = useQuery(sessionsQueryOptions());
  const subjects = projects.data ?? noSubjects;
  const sessions = sessionList.data ?? noSessions;
  const subjectState = loadingState(projects.status);
  const sessionState = loadingState(sessionList.status);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ItemFilter>('all');
  const { subject, project, invalidSubject, canSearch } = sidebarScope(
    subjects,
    requestedProject,
    global,
    subjectState
  );
  const { result, hits } = useSidebarSearch({ query, global, project, canSearch, section, filter });
  const visibleSessions = sidebarSessions(sessions, invalidSubject, requestedProject, project);

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
      void projects.refetch();
    },
    reloadSessions: () => {
      void sessionList.refetch();
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

  return requested ? sessions.filter((session) => session.projectId === project) : sessions;
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
      void navigate({ to: '/home', search: { project: String(id) } });
    } else {
      void navigate({ to: '.', search: { project: String(id) } });
    }
  };
  const createSession = () => {
    if (!project || creating) return;

    setActionError(false);
    sessionMutation.mutate(project, {
      onError: () => setActionError(true),
      onSuccess: (created) => {
        clearSearch();
        void navigate({
          to: '/sessions',
          search: { project: String(project), id: String(created.id) }
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
