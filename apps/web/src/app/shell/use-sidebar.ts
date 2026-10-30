import type { ProjectId } from '@study/contracts/ids';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ItemFilter } from '../../features/library';
import { useAction } from '../../lib/effect/use-action';
import { useOperation } from '../../lib/effect/use-operation';
import type { PageMetadata } from '../../lib/navigation/route-contract';
import {
  createProject,
  createSession as createSessionOperation,
  listProjects,
  listSessions
} from '../../lib/study-client/operations';
import type { Sessions, Subjects } from '../../lib/study-client/operations';
import { filterSearchHits, searchSessions } from './sidebar.logic';

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
  const subjectsOperation = useMemo(() => listProjects(), []);
  const sessionsOperation = useMemo(() => listSessions(), []);
  const projects = useOperation('projects', subjectsOperation);
  const sessionList = useOperation('sessions', sessionsOperation, true);
  const subjects = projects.state.status === 'ready' ? projects.state.value : noSubjects;
  const sessions = sessionList.state.status === 'ready' ? sessionList.state.value : noSessions;
  const subjectState = projects.state.status;
  const sessionState = sessionList.state.status;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ItemFilter>('all');
  const [newSubjectOpen, setNewSubjectOpen] = useState(false);
  const [name, setName] = useState('');
  const [actionError, setActionError] = useState(false);
  const action = useAction();
  const creating = action.pending;
  const searchRef = useRef<HTMLInputElement>(null);
  const subject = subjects.find((item) => String(item.id) === requestedProject);
  const project = subjectState === 'ready' ? subject?.id : undefined;
  const invalidSubject =
    !global && Boolean(requestedProject) && subjectState === 'ready' && !subject;
  const canSearch = global || !requestedProject || Boolean(project);
  const searchKey = JSON.stringify([query.trim(), global, requestedProject, filter]);
  const searchOperation = useMemo(
    () =>
      query.trim() && canSearch && (section === 'sessions' || section === 'pipelines')
        ? searchSessions({
            query: query.trim(),
            project: global ? undefined : project,
            limit: 30,
            ...(global ? {} : { kinds: ['session', 'message'] })
          })
        : undefined,
    [query, canSearch, section, global, project]
  );
  const searchResult = useOperation(searchKey, searchOperation);
  const result =
    searchResult.state.status === 'ready'
      ? { result: searchResult.state.value, error: false }
      : searchResult.state.status === 'error'
        ? { result: undefined, error: true }
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
      void navigate({ to: '/Home', search: { project: String(id) } });
    } else {
      void navigate({ to: '.', search: { project: String(id) } });
    }
  };
  const createSession = async () => {
    if (!project) return;

    setActionError(false);
    const outcome = await action.run(createSessionOperation(project));

    if (outcome.status === 'error') setActionError(true);

    if (outcome.status !== 'ready') return;

    sessionList.reload();
    clearSearch();
    await navigate({
      to: '/Sessions',
      search: { project: String(project), id: String(outcome.value.id) }
    });
  };
  const createSubject = async () => {
    if (!name.trim()) return;

    setActionError(false);
    const outcome = await action.run(createProject(name.trim()));

    if (outcome.status === 'error') setActionError(true);

    if (outcome.status !== 'ready') return;

    const created = outcome.value;

    projects.replace((items) => [
      ...(items ?? []).filter((item) => item.id !== created.id),
      created
    ]);
    setNewSubjectOpen(false);
    setName('');
    selectSubject(created.id);
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
    reloadSubjects: projects.reload,
    reloadSessions: sessionList.reload
  };
}

export type SidebarModel = ReturnType<typeof useSidebar>;
