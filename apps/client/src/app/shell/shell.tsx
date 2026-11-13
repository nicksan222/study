import { Shell as PageShell } from '@study/ui/shell';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useMatches, useSearch, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { projectsQueryOptions } from '#client/lib/study-client/study.queries.ts';

import { DefaultContextMenu } from './default-context-menu';
import { DesktopUpdates } from './desktop-updates';
import { Sidebar } from './sidebar';
import { useSidebarContext } from './sidebar-context.queries';

/** Owns sidebar visibility and transfers keyboard search focus when the note navigation opens. */
function useShellNavigation(notes: boolean, practice: boolean) {
  const [open, setOpen] = useState(() => !practice || window.innerWidth >= 700);
  const focusSearch = useRef(false);

  useEffect(() => {
    if (!practice) return;

    const media = window.matchMedia('(min-width: 700px)');
    const resize = (event: MediaQueryListEvent) => setOpen(event.matches);

    media.addEventListener('change', resize);

    return () => media.removeEventListener('change', resize);
  }, [practice]);

  useEffect(() => {
    if (!notes || open) return;

    const revealSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;

      event.preventDefault();
      focusSearch.current = true;
      setOpen(true);
    };

    window.addEventListener('keydown', revealSearch);

    return () => window.removeEventListener('keydown', revealSearch);
  }, [notes, open]);
  useEffect(() => {
    if (!open || !focusSearch.current) return;

    focusSearch.current = false;
    document.querySelector<HTMLInputElement>('.study-sidebar-search input')?.focus();
  }, [open]);

  return {
    visible: !notes || open,
    collapsed: !open,
    open,
    toggle: () => setOpen((value) => !value)
  };
}

/** Keeps a page heading accessible when the note layout hides its visual top bar. */
function ShellHeader({
  notes,
  visible,
  title,
  onToggle,
  header
}: {
  header?: 'workspace';
  notes: boolean;
  visible: boolean;
  title: string;
  onToggle: () => void;
}) {
  const { t } = useI18n();

  if (header === 'workspace')
    return visible ? null : (
      <SidebarUI.Toggle
        placement="reveal"
        label={t('ToggleSidebar')}
        expanded={false}
        onClick={onToggle}
      />
    );

  if (!notes) return <SidebarUI.Topbar parent={t('AppName')} title={title} />;

  return (
    <>
      <SidebarUI.ScreenReaderHeading>{title}</SidebarUI.ScreenReaderHeading>
      {!visible && (
        <SidebarUI.Toggle
          placement="reveal"
          label={t('ToggleSidebar')}
          expanded={false}
          onClick={onToggle}
        />
      )}
    </>
  );
}

function usePageLayout(notes: boolean, pages: boolean, workspace: boolean) {
  const search = useSearch({ from: '__root__' });
  const params = useParams({ strict: false });
  const editingPage = pages && params.pageId !== undefined && !search.pageVersion;

  return notes || editingPage || workspace ? 'bleed' : 'padded';
}

/** Selects the note layout from route metadata and composes the shared application shell. */
export function Shell() {
  const { t } = useI18n();
  const matches = useMatches();
  const metadata = matches.at(-1)?.staticData ?? {};
  const title = metadata.title ?? 'Home';
  const notes = title === 'Notes';
  const notebook = ['Notes', 'Assistant'].includes(title);
  const layout = usePageLayout(
    notes,
    metadata.section === 'pages',
    metadata.header === 'workspace'
  );
  const navigation = useShellNavigation(notebook, metadata.section === 'practice');
  const context = useSidebarContext({
    title,
    section: metadata.section ?? 'notes',
    scope: metadata.scope ?? 'project',
    sidebar: metadata.sidebar
  });
  const { project, shortcutsDisabled } = useContextMenuScope(metadata.scope, context);

  return (
    <>
      <DesktopUpdates />
      <DefaultContextMenu project={project} disabled={shortcutsDisabled}>
        <SidebarUI.Frame
          variant={notebook ? 'note-entry' : 'default'}
          data-entry-navigation={navigation.open}
          collapsed={navigation.collapsed}
          defaultWidth={288}
          minWidth={224}
          minContentWidth={360}
          storageKey="study-sidebar-width"
          resizeLabel={t('ResizeSidebar')}
          resizeHint={t('ResizeSidebarHint')}
        >
          {navigation.visible && (
            <Sidebar
              metadata={{
                title,
                section: metadata.section ?? 'notes',
                scope: metadata.scope ?? 'project',
                sidebar: metadata.sidebar
              }}
              collapsed={navigation.collapsed}
              onToggle={navigation.toggle}
            />
          )}
          <SidebarUI.Main>
            <ShellHeader
              header={metadata.header}
              notes={notebook}
              visible={navigation.visible}
              title={t(title)}
              onToggle={navigation.toggle}
            />
            <PageShell.PageBody layout={layout}>
              <Outlet />
            </PageShell.PageBody>
          </SidebarUI.Main>
        </SidebarUI.Frame>
      </DefaultContextMenu>
    </>
  );
}

function useContextMenuScope(
  scope: 'global' | 'project' | undefined,
  context: ReturnType<typeof useSidebarContext>
) {
  const subjects = useQuery(projectsQueryOptions());
  const project =
    scope === 'global'
      ? undefined
      : subjects.data?.find((subject) => String(subject.id) === context.requestedProject)?.id;
  const shortcutsDisabled =
    !context.ready ||
    (scope !== 'global' &&
      Boolean(context.requestedProject) &&
      (!subjects.isSuccess || project === undefined));

  return { project, shortcutsDisabled };
}
