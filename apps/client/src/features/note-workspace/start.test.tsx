import { StudyError, noteSchema, defaultWorkspacePreferences } from '@study/contracts';
import { test } from '@study/testing';
import { WorkspaceCard } from '@study/ui';
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  stringifySearchWith,
  Outlet,
  RouterProvider
} from '@tanstack/react-router';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';

import type * as __MockType0 from '#client/app/shell/sidebar-note-drafts.tsx';

import type * as __MockType1 from './start';
import type * as __MockType2 from './start-drafts.queries';

let SidebarNoteDrafts: typeof __MockType0.SidebarNoteDrafts;

let NoteStart: typeof __MockType1.NoteStart;

let startDraftKey: typeof __MockType2.startDraftKey;

let startDraft: typeof __MockType2.startDraft;

let startDrafts: typeof __MockType2.startDrafts;

let api: ReturnType<typeof createMockState>['api'];

const clients: AtomRegistry.AtomRegistry[] = [];

function mount({
  rpcHandlersTransport,
  render
}: Pick<test.unit.Context, 'rpcHandlersTransport' | 'render'>) {
  const cache = AtomRegistry.make();
  const fixture = rpcHandlersTransport(
    {
      'notes.createUntitledNote': ({ project, initialMessage }) =>
        api.create(project, initialMessage),
      'notes.notes': async () => ({ items: [], next: null }),
      'projects.projects': async () => ({ items: [], next: null }),
      'settings.workspacePreferences': async () => defaultWorkspacePreferences
    },
    cache
  );
  const Provider = fixture.wrapper;

  clients.push(cache);
  const root = createRootRoute({
    validateSearch: (search: Record<string, unknown>) => ({
      project: typeof search.project === 'string' ? search.project : undefined
    }),
    component: () => (
      <>
        <SidebarNoteDrafts subjects={[]} project={undefined} />
        <Outlet />
      </>
    )
  });
  const start = createRoute({
    getParentRoute: () => root,
    path: '/notes',
    component: () => (
      <WorkspaceCard.Provider>
        <NoteStart />
      </WorkspaceCard.Provider>
    )
  });
  const saved = createRoute({
    getParentRoute: () => root,
    path: '/notes/$noteId',
    component: () => <p>Saved note</p>
  });
  const pages = createRoute({
    getParentRoute: () => root,
    path: '/pages',
    component: () => <p>Pages</p>
  });
  const router = createRouter({
    parseSearch: (value) => Object.fromEntries(new URLSearchParams(value)),
    stringifySearch: stringifySearchWith(String),
    routeTree: root.addChildren([start, saved, pages]),
    history: createMemoryHistory({ initialEntries: ['/notes?project=1'] })
  });
  const view = render(
    <Provider>
      <RouterProvider router={router} />
    </Provider>
  );

  return { cache, router, ...view };
}

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ create: mock.fn() }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  mock('#client/features/note-workspace/workspace-context', () => ({
    WorkspaceContext: () => null
  }));
  const __mockModule0 = await import('#client/app/shell/sidebar-note-drafts.tsx');

  SidebarNoteDrafts = __mockModule0.SidebarNoteDrafts;
  const __mockModule1 = await import('./start');

  NoteStart = __mockModule1.NoteStart;
  const __mockModule2 = await import('./start-drafts.queries');

  startDraftKey = __mockModule2.startDraftKey;
  startDraft = __mockModule2.startDraft;
  startDrafts = __mockModule2.startDrafts;
});

test.unit.beforeEach(({ vi }) => vi.resetAllMocks());
test.unit.afterEach(({ cleanup }) => {
  cleanup();
  clients.splice(0).forEach((cache) => cache.dispose());
});

test.unit.stable(
  'opening, typing and switching subjects only cache drafts until first send',
  async ({ screen, fireEvent, act, expect, waitFor, rpcHandlersTransport, render }) => {
    const { cache, router } = mount({ rpcHandlersTransport, render });
    const input = await screen.findByRole('textbox', { name: 'NoteCompose' });

    fireEvent.change(input, { target: { value: 'Math draft' } });
    await act(async () => {
      await router.navigate({ to: '/notes', search: { project: '2' } });
    });
    expect(screen.getByRole('textbox', { name: 'NoteCompose' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'NoteCompose' }), {
      target: { value: 'History draft' }
    });
    await act(async () => {
      await router.navigate({ to: '/notes', search: { project: '1' } });
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'NoteCompose' })).toHaveValue('Math draft')
    );
    expect(cache.get(startDrafts)).toEqual(['2', '1']);
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'SidebarDismissDraft' })[1]!);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'NoteCompose' })).toHaveValue('')
    );
    expect(cache.get(startDraft(startDraftKey('1')))).toBe('');
    expect(cache.get(startDraft(startDraftKey('2')))).toBe('History draft');
  }
);

test.unit.stable(
  'first send creates once, consumes its draft, and preserves later typing',
  async ({ screen, fireEvent, waitFor, expect, act, rpcHandlersTransport, render }) => {
    let resolve!: (value: unknown) => void;

    api.create.mockImplementation(
      () =>
        new Promise((accept) => {
          resolve = accept;
        })
    );
    const { cache } = mount({ rpcHandlersTransport, render });
    const input = await screen.findByRole('textbox', { name: 'NoteCompose' });

    fireEvent.change(input, { target: { value: 'Lecture notes' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledExactlyOnceWith(1n, {
        text: 'Lecture notes',
        sourceIds: []
      })
    );
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    fireEvent.change(input, { target: { value: 'Newer notes' } });
    await act(async () =>
      resolve(
        Schema.decodeUnknownSync(noteSchema)({
          id: 10n,
          title: 'Lecture',
          titleSource: 'user',
          archivedAt: null,
          projectIds: [1n],
          createdAt: 1n,
          updatedAt: 1n
        })
      )
    );
    await screen.findByText('Saved note');
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(cache.get(startDraft(startDraftKey('1')))).toBe('Newer notes');
    expect(cache.get(startDrafts)).toEqual(['1']);
  }
);

test.unit.stable(
  'lost creation receipts retain the draft and prevent duplicate creation across remount',
  async ({ fireEvent, screen, waitFor, expect, act, rpcHandlersTransport, render }) => {
    api.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
    const { router } = mount({ rpcHandlersTransport, render });

    fireEvent.change(await screen.findByRole('textbox', { name: 'NoteCompose' }), {
      target: { value: 'Keep my note' }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await screen.findByText('NoteCreationUncertain');
    await act(async () => {
      await router.navigate({ to: '/pages', search: { project: '1' } });
    });
    await act(async () => {
      await router.navigate({ to: '/notes', search: { project: '1' } });
    });
    expect(await screen.findByRole('textbox', { name: 'NoteCompose' })).toHaveValue('Keep my note');
    expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'SidebarDismissDraft' })).toBeDisabled();
    expect(api.create).toHaveBeenCalledTimes(1);
  }
);
