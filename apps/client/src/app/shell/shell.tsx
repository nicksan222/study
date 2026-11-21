import { rpc } from '@study/contracts/react';
import { Shell as PageShell, Sidebar as SidebarUI } from '@study/ui';
import { Outlet, useMatches, useSearch, useParams } from '@tanstack/react-router';
import type { Ref } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { WrittenExamProvider } from '#client/features/practice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { useNarrowLayout } from '#client/lib/viewport.ts';

import { DefaultContextMenu } from './default-context-menu';
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
function usePhoneNavigation(route: string, library: boolean) {
  const [state, setState] = useState({ route, open: false });
  const open = library || (state.route === route && state.open);

  if (state.route !== route) setState({ route, open: false });

  return {
    visible: open,
    collapsed: false,
    open,
    toggle: () => setState({ route, open: !open })
  };
}

function useDrawerFocus(narrow: boolean, visible: boolean) {
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const revealToggle = useRef<HTMLButtonElement>(null);
  const previous = useRef({ narrow, visible });

  useLayoutEffect(() => {
    const before = previous.current;

    previous.current = { narrow, visible };

    if (!(narrow || before.narrow) || before.visible === visible) return;

    const active = document.activeElement;

    if (active === document.body || active?.closest('[hidden], [inert]'))
      (visible ? drawerToggle : revealToggle).current?.focus({ preventScroll: true });
  }, [narrow, visible]);

  return { drawerToggle, revealToggle };
}

/** Keeps a page heading accessible when the note layout hides its visual top bar. */
function ShellHeader({
  notes,
  visible,
  title,
  onToggle,
  toggleRef,
  header,
  parentTitle,
  materials
}: {
  header?: 'workspace';
  materials: boolean;
  parentTitle?: string;
  notes: boolean;
  visible: boolean;
  title: string;
  onToggle: () => void;
  toggleRef: Ref<HTMLButtonElement>;
}) {
  const { t } = useI18n();

  const toggle = visible ? null : (
    <SidebarUI.Toggle
      ref={toggleRef}
      aria-controls="study-sidebar-navigation"
      placement={header === 'workspace' || notes ? 'reveal' : 'default'}
      label={t(materials ? 'UploadedMaterialsBack' : 'ToggleSidebar')}
      expanded={false}
      onClick={onToggle}
    />
  );

  if (header === 'workspace') return toggle;

  if (!notes)
    return (
      <SidebarUI.Topbar parent={parentTitle ?? t('AppName')} title={title}>
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

function usePageLayout(notes: boolean, workspace: boolean) {
  const search = useSearch({ from: '__root__' });
  const params = useParams({ strict: false });
  const editingPage = params.pageId !== undefined && !search.pageVersion;

  return notes || editingPage || workspace ? 'bleed' : 'padded';
}

function useNavigation(pathname: string, notebook: boolean, practice: boolean) {
  const phone = useNarrowLayout();
  const search = useSearch({ from: '__root__' });
  const path = pathname.replace(/\/$/, '');
  const library =
    (path === '/uploads' && Boolean(search.project)) ||
    ['/practice', '/flashcards'].includes(path) ||
    (path === '/projects' && !search.project);
  const desktop = useShellNavigation(notebook && !phone, practice && !phone);
  const drawer = usePhoneNavigation(`${path}:${search.project ?? ''}`, library);

  const navigation = phone ? drawer : desktop;

  useSearchShortcut(phone || notebook, navigation.open, navigation.toggle);

  return { ...navigation, phone, library };
}

/** Selects the note layout from route metadata and composes the shared application shell. */
export function Shell() {
  return (
    <WrittenExamProvider>
      <ShellContent />
    </WrittenExamProvider>
  );
}

function useShellRoute() {
  const matches = useMatches();
  const match = matches.at(-1);
  const {
    title = 'Home',
    section = 'notes',
    scope = 'project',
    sidebar,
    header
  } = match?.staticData ?? {};
  const fromUploads = useSearch({
    from: '__root__',
    select: (search) => search.fromUploads === '1'
  });
  const materialReader = title === 'AnswerSources' && fromUploads;
  const metadata = materialReader
    ? {
        title: 'UploadedMaterials' as const,
        section: 'uploads' as const,
        scope: 'project' as const
      }
    : { title, section, scope, sidebar };

  return { metadata, header, pathname: match?.pathname ?? '' };
}

function ShellContent() {
  const { t } = useI18n();
  const { metadata, header, pathname } = useShellRoute();
  const { title, section } = metadata;
  const notes = title === 'Notes';
  const notebook = ['Notes', 'Assistant'].includes(title);
  const layout = usePageLayout(notes, header === 'workspace' || section === 'uploads');
  const navigation = useNavigation(pathname, notebook, section === 'practice');
  const { drawerToggle, revealToggle } = useDrawerFocus(navigation.phone, navigation.visible);
  const context = useSidebarContext(metadata);
  const { project, projectName, shortcutsDisabled } = useContextMenuScope(metadata.scope, context);

  return (
    <>
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
          <Sidebar
            metadata={metadata}
            collapsed={navigation.collapsed}
            hidden={!navigation.visible}
            primary={navigation.phone && navigation.library}
            onToggle={navigation.toggle}
            toggleRef={drawerToggle}
          />
          <SidebarUI.Main data-section={section} inert={navigation.phone && navigation.open}>
            <ShellHeader
              header={header}
              materials={section === 'uploads'}
              parentTitle={section === 'uploads' ? projectName : undefined}
              notes={notebook}
              visible={navigation.visible}
              title={t(title)}
              onToggle={navigation.toggle}
              toggleRef={revealToggle}
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
  const subject =
    scope === 'global'
      ? undefined
      : subjects.data?.items.find((subject) => String(subject.id) === context.requestedProject);
  const shortcutsDisabled =
    !context.ready ||
    (scope !== 'global' &&
      Boolean(context.requestedProject) &&
      (!subjects.isSuccess || subject === undefined));

  return { project: subject?.id, projectName: subject?.name, shortcutsDisabled };
}
