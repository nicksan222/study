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
  const navigate = useNavigate();
  const search = useSearch({ from: '__root__' });
  const requestedProject = search.project ?? null;
  const selectedSession = metadata.title === 'Sessions' ? (search.id ?? null) : null;
  const global = metadata.scope === 'global';
  const section = metadata.section;
  const queryClient = useQueryClient();
  const projects = useQuery(projectsQueryOptions());
  const sessionList = useQuery(sessionsQueryOptions());
  const subjects = projects.data ?? noSubjects;
  const sessions = sessionList.data ?? noSessions;
  const subjectState =
    projects.status === 'success' ? 'ready' : projects.status === 'pending' ? 'loading' : 'error';
  const sessionState =
    sessionList.status === 'success'
      ? 'ready'
      : sessionList.status === 'pending'
        ? 'loading'
        : 'error';
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ItemFilter>('all');
  const [newSubjectOpen, setNewSubjectOpen] = useState(false);
  const [name, setName] = useState('');
  const [actionError, setActionError] = useState(false);
  const subjectMutation = useMutation(createProjectMutationOptions(queryClient));
  const sessionMutation = useMutation(createSessionMutationOptions(queryClient));
  const creating = subjectMutation.isPending || sessionMutation.isPending;
  const searchRef = useRef<HTMLInputElement>(null);
  const subject = subjects.find((item) => String(item.id) === requestedProject);
  const project = subjectState === 'ready' ? subject?.id : undefined;
  const invalidSubject =
    !global && Boolean(requestedProject) && subjectState === 'ready' && !subject;
  const canSearch = global || !requestedProject || Boolean(project);
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
  const result = searchEnabled
    ? searchResult.isSuccess
      ? { result: searchResult.data, error: false }
      : searchResult.isError
        ? { result: undefined, error: true }
        : undefined
    : undefined;
  const hits = filterSearchHits(result?.result?.hits ?? [], filter);
  const visibleSessions = invalidSubject
    ? []
    : requestedProject
      ? sessions.filter((session) => session.projectId === project)
      : sessions;

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

  const clearSearch = () => {
    setQuery('');
    setFilter('all');
  };
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
