import type { SessionDto } from '@study/contracts/conversations/schemas';
import type { ProjectId } from '@study/contracts/ids';
import type { Project } from '@study/contracts/projects/schemas';
import type { searchResultSchema } from '@study/contracts/system/schemas';
import { age } from '@study/localization';
import { Button } from '@study/ui/button';
import { useNowMinute } from '@study/ui/clock';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from '@study/ui/dialog';
import { Input } from '@study/ui/input';
import { Menu, MenuTrigger, MenuPopup, MenuItem } from '@study/ui/menu';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Effect } from 'effect';
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
import { useEffect, useRef, useState } from 'react';

import { useI18n } from './i18n';
import type { PageName } from './navigation';
import { SidebarItems } from './sidebar-items';
import type { SidebarItemFilter } from './sidebar-items';
import { SidebarNavigation } from './sidebar-navigation';
import { runStudy } from './study-client';

type Sessions = readonly SessionDto[];

type Subjects = Project[];

type SearchResults = typeof searchResultSchema.Type;

type SearchHit = SearchResults['hits'][number];

const globalPages: readonly PageName[] = ['Projects', 'Settings', 'Help'];

function resultLocation(hit: SearchHit, project: ProjectId | undefined) {
  switch (hit.target.type) {
    case 'project':
      return { to: '/Home', search: { project: String(hit.target.id) } } as const;
    case 'session':
      return {
        to: '/Sessions',
        search: { project: String(hit.target.projectId), id: String(hit.target.sessionId) }
      } as const;
    case 'material':
      return {
        to:
          hit.target.materialKind === 'diagram'
            ? '/Diagrams'
            : hit.target.materialKind === 'flashcards'
              ? '/Flashcards'
              : hit.target.materialKind === 'quiz'
                ? '/Practice'
                : '/MediaList',
        search: { project: String(hit.target.projectId), material: String(hit.target.materialId) }
      } as const;
    case 'question':
      return {
        to: '/Practice',
        search: { project: String(hit.target.projectId), material: String(hit.target.materialId) }
      } as const;
    case 'source':
      return {
        to: '/MediaList',
        search: {
          id: String(hit.target.sourceId),
          ...(project ? { project: String(project) } : {})
        }
      } as const;
  }
}

export function Sidebar({
  page,
  collapsed,
  onToggle
}: {
  page: PageName;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t, locale, date } = useI18n();
  const now = useNowMinute();
  const navigate = useNavigate();
  const searchStr = useLocation({ select: (location) => location.searchStr });
  const requestedProject = new URLSearchParams(searchStr).get('project');
  const selectedSession = page === 'Sessions' ? new URLSearchParams(searchStr).get('id') : null;
  const global = globalPages.includes(page);
  const section =
    page === 'MediaList' || page === 'Diagrams'
      ? 'library'
      : page === 'Practice' || page === 'Flashcards'
        ? 'practice'
        : 'sessions';
  const [subjects, setSubjects] = useState<Subjects>([]);
  const [sessions, setSessions] = useState<Sessions>([]);
  const [sessionState, setSessionState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sessionRefresh, setSessionRefresh] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [subjectState, setSubjectState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SidebarItemFilter>('all');
  const [searchState, setSearchState] = useState<{
    key: string;
    result?: SearchResults;
    error?: boolean;
  }>();
  const [creating, setCreating] = useState(false);
  const [newSubjectOpen, setNewSubjectOpen] = useState(false);
  const [name, setName] = useState('');
  const [actionError, setActionError] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const subjectRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const subject = subjects.find((item) => String(item.id) === requestedProject);
  const project = subjectState === 'ready' ? subject?.id : undefined;
  const invalidSubject =
    !global && Boolean(requestedProject) && subjectState === 'ready' && !subject;
  const searchKey = JSON.stringify([query.trim(), global, requestedProject, filter]);
  const canSearch = global || !requestedProject || Boolean(project);

  useEffect(() => {
    const controller = new AbortController();

    actionRequest.current = controller;

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    subjectRequest.current = controller;
    void runStudy(
      (client) =>
        Effect.gen(function* () {
          const items: Project[] = [];
          let before: ProjectId | undefined;

          do {
            const page = yield* client['projects.projects']({ limit: 100, before });

            items.push(...page.items);
            before = page.next ?? undefined;
          } while (before !== undefined);

          return { items };
        }),
      controller.signal
    ).then(
      (result) => {
        if (!controller.signal.aborted) {
          setSubjects(result.items);
          setSubjectState('ready');
        }
      },
      () => {
        if (!controller.signal.aborted) setSubjectState('error');
      }
    );

    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();

    void runStudy(
      (client) =>
        Effect.gen(function* () {
          const items: SessionDto[] = [];
          let before: { updatedAt: bigint; id: SessionDto['id'] } | undefined;

          do {
            const page = yield* client['conversations.sessions']({ limit: 100, before });

            items.push(...page.items);
            before = page.next ?? undefined;
          } while (before !== undefined);

          return { items };
        }),
      controller.signal
    ).then(
      (result) => {
        if (!controller.signal.aborted) {
          setSessions(result.items);
          setSessionState('ready');
        }
      },
      () => {
        if (!controller.signal.aborted) setSessionState('error');
      }
    );
    const refreshSessions = () => setSessionRefresh((value) => value + 1);

    window.addEventListener('focus', refreshSessions);

    return () => {
      controller.abort();
      window.removeEventListener('focus', refreshSessions);
    };
  }, [sessionRefresh]);

  useEffect(() => {
    if (!query.trim() || !canSearch || section !== 'sessions') return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void runStudy(
        (client) =>
          client['system.search']({
            query: query.trim(),
            project: global ? undefined : project,
            limit: 30,
            ...(global ? {} : { kinds: ['session', 'message'] })
          }),
        controller.signal
      ).then(
        (result) => {
          if (!controller.signal.aborted) setSearchState({ key: searchKey, result });
        },
        () => {
          if (!controller.signal.aborted) setSearchState({ key: searchKey, error: true });
        }
      );
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, project, global, canSearch, searchKey, filter, section]);

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
    void navigate({ to: global ? '/Home' : `/${page}`, search: { project: String(id) } });
  };
  const createSession = async () => {
    if (!project || creating) return;

    setCreating(true);
    setActionError(false);

    try {
      const session = await runStudy(
        (client) => client['conversations.createUntitledSession']({ project }),
        actionRequest.current?.signal
      );

      setSessionRefresh((value) => value + 1);
      clearSearch();
      await navigate({
        to: '/Sessions',
        search: { project: String(project), id: String(session.id) }
      });
    } catch {
      setActionError(true);
    } finally {
      setCreating(false);
    }
  };
  const createSubject = async () => {
    if (!name.trim() || creating) return;

    setCreating(true);
    setActionError(false);

    try {
      const created = await runStudy(
        (client) => client['projects.createProject']({ name: name.trim() }),
        actionRequest.current?.signal
      );

      subjectRequest.current?.abort();
      setSubjects((items) => [...items.filter((item) => item.id !== created.id), created]);
      setSubjectState('ready');
      setNewSubjectOpen(false);
      setName('');
      selectSubject(created.id);
    } catch {
      setActionError(true);
    } finally {
      setCreating(false);
    }
  };
  const result = searchState?.key === searchKey ? searchState : undefined;
  const hits =
    result?.result?.hits.filter(
      (hit) =>
        filter === 'all' || hit.kind === filter || (filter === 'session' && hit.kind === 'message')
    ) ?? [];

  return (
    <SidebarUI.Root aria-label={t('SidebarNavigation')}>
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

            if (open) setRefresh((value) => value + 1);
          }}
          collapsed={collapsed}
          label={t('ChooseProject')}
          fallbackIcon={<Folder aria-hidden="true" />}
          searchLabel={t('FindSubject')}
          empty={
            subjectState === 'ready'
              ? t(subjects.length === 0 ? 'NoProjectsYet' : 'SearchNoResults')
              : null
          }
          status={
            subjectState === 'loading' ? (
              <SidebarUI.Message role="status">{t('LoadingSubjects')}</SidebarUI.Message>
            ) : subjectState === 'error' ? (
              <Button
                variant="ghost-muted"
                layout="navigation"
                onClick={() => setRefresh((value) => value + 1)}
              >
                {t('SubjectsLoadError')}
              </Button>
            ) : null
          }
        >
          <Button
            variant="ghost-muted"
            layout="navigation"
            render={
              <Link
                to="/Home"
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
                to="/Projects"
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
                to="/Help"
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
      <SidebarUI.Toolbar>
        {collapsed ? (
          <Button
            size="icon"
            variant="ghost-muted"
            aria-label={t('Search')}
            title={t('Search')}
            onClick={() => {
              onToggle();
              requestAnimationFrame(() => searchRef.current?.focus());
            }}
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
        <Menu>
          <MenuTrigger
            render={<Button size="icon" variant={filter === 'all' ? 'ghost-muted' : 'secondary'} />}
            aria-label={t('SearchFilter')}
            title={t('SearchFilter')}
          >
            <ListFilter aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="start">
            {(section === 'library'
              ? (['all', 'source', 'diagram'] as const)
              : section === 'practice'
                ? (['all', 'flashcards', 'quiz'] as const)
                : (['all', 'session'] as const)
            ).map((kind) => (
              <MenuItem key={kind} onClick={() => setFilter(kind)}>
                {t(
                  kind === 'all'
                    ? 'FilterAll'
                    : kind === 'session'
                      ? 'Sessions'
                      : kind === 'source'
                        ? 'MediaList'
                        : kind === 'diagram'
                          ? 'Diagrams'
                          : kind === 'flashcards'
                            ? 'Flashcards'
                            : 'SidebarQuiz'
                )}
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
          <SquarePen aria-hidden="true" />
        </Button>
      </SidebarUI.Toolbar>
      <SidebarUI.Content>
        {invalidSubject && (
          <SidebarUI.Message role="status">{t('SubjectNotFound')}</SidebarUI.Message>
        )}
        {subjectState === 'error' && !pickerOpen && (
          <Button variant="ghost-muted" onClick={() => setRefresh((value) => value + 1)}>
            {t('SubjectsLoadError')}
          </Button>
        )}
        {actionError && !newSubjectOpen && (
          <SidebarUI.Message role="alert">{t('ActionError')}</SidebarUI.Message>
        )}
        {section !== 'sessions' ? (
          <SidebarItems
            section={section}
            subjects={subjects}
            project={project}
            blocked={Boolean(requestedProject) && (!project || subjectState !== 'ready')}
            ready={subjectState === 'ready'}
            query={query}
            filter={filter}
          />
        ) : query.trim() ? (
          <SidebarUI.Items aria-label={t('Search')} aria-busy={canSearch && !result}>
            {canSearch && !result && (
              <SidebarUI.Message role="status">{t('Searching')}</SidebarUI.Message>
            )}
            {result?.error && (
              <SidebarUI.Message role="alert">{t('SearchFailed')}</SidebarUI.Message>
            )}
            {result?.result && !result.result.semantic && (
              <SidebarUI.Message>{t('SearchKeywordOnly')}</SidebarUI.Message>
            )}
            {result?.result && hits.length === 0 && (
              <SidebarUI.Message role="status">{t('SearchNoResults')}</SidebarUI.Message>
            )}
            {hits.map((hit) => (
              <SidebarUI.Item
                key={`${hit.target.type}:${hit.target.type === 'project' ? hit.target.id : hit.target.type === 'session' ? hit.target.sessionId : hit.target.type === 'source' ? hit.target.sourceId : hit.target.materialId}:${hit.at}:${hit.excerpt ?? ''}`}
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
                render={
                  <Link
                    {...resultLocation(hit, global ? undefined : project)}
                    onClick={clearSearch}
                  />
                }
              />
            ))}
          </SidebarUI.Items>
        ) : (
          <SidebarUI.Items id="study-sidebar-sessions" aria-label={t('Sessions')}>
            {sessionState === 'loading' && (
              <SidebarUI.Message role="status">{t('LoadingSessions')}</SidebarUI.Message>
            )}
            {sessionState === 'error' && (
              <Button variant="ghost-muted" onClick={() => setSessionRefresh((value) => value + 1)}>
                {t('SessionsLoadError')}
              </Button>
            )}
            {sessionState === 'ready' &&
              !invalidSubject &&
              (requestedProject
                ? sessions.filter((session) => session.projectId === project)
                : sessions
              ).map((session) => {
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
                        to="/Sessions"
                        search={{ project: String(session.projectId), id: String(session.id) }}
                      />
                    }
                  />
                );
              })}
            {sessionState === 'ready' &&
              !invalidSubject &&
              !(requestedProject
                ? sessions.some((session) => session.projectId === project)
                : sessions.length > 0) && (
                <SidebarUI.Message>{t('DashboardNoSessions')}</SidebarUI.Message>
              )}
          </SidebarUI.Items>
        )}
      </SidebarUI.Content>
      <SidebarNavigation page={page} project={requestedProject} onNavigate={clearSearch} />
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
                {t(creating ? 'Saving' : 'CreateProject')}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </SidebarUI.Root>
  );
}
