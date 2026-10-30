import { age } from '@study/localization';
import { Button } from '@study/ui/button';
import { useNowMinute } from '@study/ui/clock';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from '@study/ui/dialog';
import { Input } from '@study/ui/input';
import { Menu, MenuTrigger, MenuPopup, MenuItem } from '@study/ui/menu';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Link } from '@tanstack/react-router';
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
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';
import { SidebarNavigation } from './sidebar-navigation.view';
import { resultLocation } from './sidebar.locations';
import type { SidebarModel } from './use-sidebar';

export function SidebarView({
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
  sessions,
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
  reloadSubjects,
  reloadSessions,
  library
}: SidebarModel & { library: ReactNode }) {
  const { t, locale, date } = useI18n();
  const now = useNowMinute();

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

            if (open) reloadSubjects();
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
              <Button variant="ghost-muted" layout="navigation" onClick={() => reloadSubjects()}>
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
          <Button variant="ghost-muted" onClick={() => reloadSubjects()}>
            {t('SubjectsLoadError')}
          </Button>
        )}
        {actionError && !newSubjectOpen && (
          <SidebarUI.Message role="alert">{t('ActionError')}</SidebarUI.Message>
        )}
        {section === 'library' || section === 'practice' ? (
          library
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
              <Button variant="ghost-muted" onClick={() => reloadSessions()}>
                {t('SessionsLoadError')}
              </Button>
            )}
            {sessionState === 'ready' &&
              !invalidSubject &&
              sessions.map((session) => {
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
            {sessionState === 'ready' && !invalidSubject && sessions.length === 0 && (
              <SidebarUI.Message>{t('DashboardNoSessions')}</SidebarUI.Message>
            )}
          </SidebarUI.Items>
        )}
      </SidebarUI.Content>
      <SidebarNavigation
        section={section}
        settings={metadata.title === 'Settings'}
        project={requestedProject}
        onNavigate={clearSearch}
      />
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
