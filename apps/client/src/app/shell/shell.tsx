import { rpc } from '@study/contracts/react';
import { Shell as PageShell, Sidebar as SidebarUI } from '@study/ui';
import { Outlet, useMatches, useSearch, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { useMobileViewport } from '#client/lib/viewport.ts';

import { DefaultContextMenu } from './default-context-menu';
import { DesktopUpdates } from './desktop-updates';
import { Sidebar } from './sidebar';
import { useSidebarContext } from './sidebar-context.queries';

/** Owns sidebar visibility and transfers keyboard search focus when the note navigation opens. */
function useShellNavigation(notes: boolean, practice: boolean) {
  const responsive = notes || practice;
  const [navigation, setNavigation] = useState(() => ({
    responsive,
    open: !responsive || window.innerWidth >= 700
  }));
  const { open } = navigation;

  if (navigation.responsive !== responsive) {
    setNavigation({ responsive, open: !responsive || window.innerWidth >= 700 });
  }

  useEffect(() => {
    if (!responsive) return;

    const media = window.matchMedia('(min-width: 700px)');
    const resize = (event: MediaQueryListEvent) =>
      setNavigation({ responsive, open: event.matches });

    media.addEventListener('change', resize);

    return () => media.removeEventListener('change', resize);
  }, [responsive]);

  return {
    visible: !notes || open,
    collapsed: !open,
    open,
    toggle: () => setNavigation((current) => ({ ...current, open: !current.open }))
  };
}

function useSearchShortcut(notes: boolean, open: boolean, show: () => void) {
  const focusSearch = useRef(false);

  useEffect(() => {
    if (!notes || open) return;

    const revealSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;

      event.preventDefault();
      focusSearch.current = true;
      show();
    };

    window.addEventListener('keydown', revealSearch);

    return () => window.removeEventListener('keydown', revealSearch);
  }, [notes, open, show]);
  useEffect(() => {
    if (!open || !focusSearch.current) return;

    focusSearch.current = false;
    document.querySelector<HTMLInputElement>('.study-sidebar-search input')?.focus();
  }, [open]);
}

/** Narrow workspaces use a drawer. The library routes use it as their primary content. */
function usePhoneNavigation(path: string, library: boolean) {
  const [state, setState] = useState({ path, open: library });
  const open = state.path === path ? state.open : library;

  if (state.path !== path) setState({ path, open: library });

  return {
    visible: open,
    collapsed: false,
    open,
    toggle: () => setState({ path, open: !open })
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

  const toggle = visible ? null : (
    <SidebarUI.Toggle
      placement={header === 'workspace' || notes ? 'reveal' : 'default'}
      label={t('ToggleSidebar')}
      expanded={false}
      onClick={onToggle}
    />
  );

  if (header === 'workspace') return toggle;

  if (!notes)
    return (
      <SidebarUI.Topbar parent={t('AppName')} title={title}>
        {toggle}
      </SidebarUI.Topbar>
    );

  return (
    <>
      <SidebarUI.ScreenReaderHeading>{title}</SidebarUI.ScreenReaderHeading>
      {toggle}
    </>
  );
}

function usePageLayout(notes: boolean, pages: boolean, workspace: boolean) {
  const search = useSearch({ from: '__root__' });
  const params = useParams({ strict: false });
  const editingPage = pages && params.pageId !== undefined && !search.pageVersion;

  return notes || editingPage || workspace ? 'bleed' : 'padded';
}

function useNavigation(pathname: string, notebook: boolean, practice: boolean) {
  const phone = useMobileViewport();
  const search = useSearch({ from: '__root__' });
  const path = pathname.replace(/\/$/, '');
  const library =
    ['/practice', '/flashcards'].includes(path) || (path === '/projects' && !search.project);
  const desktop = useShellNavigation(notebook && !phone, practice && !phone);
  const drawer = usePhoneNavigation(`${path}:${library}`, library);

  const navigation = phone ? drawer : desktop;

  useSearchShortcut(phone || notebook, navigation.open, navigation.toggle);

  return { ...navigation, phone, library };
}

/** Selects the note layout from route metadata and composes the shared application shell. */
export function Shell() {
  const { t } = useI18n();
  const matches = useMatches();
  const match = matches.at(-1);
  const {
    title = 'Home',
    section = 'notes',
    scope = 'project',
    sidebar,
    header
  } = match?.staticData ?? {};
  const metadata = { title, section, scope, sidebar };
  const notes = title === 'Notes';
  const notebook = ['Notes', 'Assistant'].includes(title);
  const layout = usePageLayout(notes, section === 'pages', header === 'workspace');
  const navigation = useNavigation(match?.pathname ?? '', notebook, section === 'practice');
  const context = useSidebarContext(metadata);
  const { project, shortcutsDisabled } = useContextMenuScope(scope, context);

  return (
    <>
      <DesktopUpdates />
      <DefaultContextMenu project={project} disabled={shortcutsDisabled}>
        <SidebarUI.Frame
          variant={notebook ? 'note-entry' : 'default'}
          data-entry-navigation={navigation.open}
          data-phone-navigation={navigation.phone}
          data-phone-library={navigation.phone && navigation.library}
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
              metadata={metadata}
              collapsed={navigation.collapsed}
              onToggle={navigation.toggle}
            />
          )}
          <SidebarUI.Main>
            <ShellHeader
              header={header}
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
  const subjects = rpc.projects.list.useQuery({ limit: 100 });
  const project =
    scope === 'global'
      ? undefined
      : subjects.data?.items.find((subject) => String(subject.id) === context.requestedProject)?.id;
  const shortcutsDisabled =
    !context.ready ||
    (scope !== 'global' &&
      Boolean(context.requestedProject) &&
      (!subjects.isSuccess || project === undefined));

  return { project, shortcutsDisabled };
}
