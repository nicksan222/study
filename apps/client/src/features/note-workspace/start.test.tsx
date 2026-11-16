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

import { SidebarNoteDrafts } from '#client/app/shell/sidebar-note-drafts.tsx';

import { NoteStart } from './start';
import { startDraftKey, startDraft, startDrafts } from './start-drafts.queries';

const api = test.hoisted(() => ({ create: test.vi.fn() }));

test.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
test.mock('./workspace-context', () => ({ WorkspaceContext: () => null }));

const clients: AtomRegistry.AtomRegistry[] = [];

function mount() {
  const cache = AtomRegistry.make();
  const fixture = test.rpcHandlersTransport(
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
  const view = test.render(
    <Provider>
      <RouterProvider router={router} />
    </Provider>
  );

  return { cache, router, ...view };
}

test.beforeEach(() => test.vi.resetAllMocks());
test.afterEach(() => {
  test.cleanup();
  clients.splice(0).forEach((cache) => cache.dispose());
});

test.stable(
  'opening, typing and switching subjects only cache drafts until first send',
  async () => {
    const { cache, router } = mount();
    const input = await test.screen.findByRole('textbox', { name: 'NoteCompose' });

    test.fireEvent.change(input, { target: { value: 'Math draft' } });
    await test.act(async () => {
      await router.navigate({ to: '/notes', search: { project: '2' } });
    });
    test.expect(test.screen.getByRole('textbox', { name: 'NoteCompose' })).toHaveValue('');
    test.fireEvent.change(test.screen.getByRole('textbox', { name: 'NoteCompose' }), {
      target: { value: 'History draft' }
    });
    await test.act(async () => {
      await router.navigate({ to: '/notes', search: { project: '1' } });
    });
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('textbox', { name: 'NoteCompose' }))
        .toHaveValue('Math draft')
    );
    test.expect(cache.get(startDrafts)).toEqual(['2', '1']);
    test.expect(api.create).not.toHaveBeenCalled();
    test.fireEvent.click(test.screen.getAllByRole('button', { name: 'SidebarDismissDraft' })[1]!);
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('textbox', { name: 'NoteCompose' })).toHaveValue('')
    );
    test.expect(cache.get(startDraft(startDraftKey('1')))).toBe('');
    test.expect(cache.get(startDraft(startDraftKey('2')))).toBe('History draft');
  }
);

test.stable('first send creates once, consumes its draft, and preserves later typing', async () => {
  let resolve!: (value: unknown) => void;

  api.create.mockImplementation(
    () =>
      new Promise((accept) => {
        resolve = accept;
      })
  );
  const { cache } = mount();
  const input = await test.screen.findByRole('textbox', { name: 'NoteCompose' });

  test.fireEvent.change(input, { target: { value: 'Lecture notes' } });
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
  );
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
  await test.waitFor(() =>
    test
      .expect(api.create)
      .toHaveBeenCalledExactlyOnceWith(1n, { text: 'Lecture notes', sourceIds: [] })
  );
  test.fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  test.fireEvent.change(input, { target: { value: 'Newer notes' } });
  await test.act(async () =>
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
  await test.screen.findByText('Saved note');
  test.expect(api.create).toHaveBeenCalledTimes(1);
  test.expect(cache.get(startDraft(startDraftKey('1')))).toBe('Newer notes');
  test.expect(cache.get(startDrafts)).toEqual(['1']);
});

test.stable(
  'lost creation receipts retain the draft and prevent duplicate creation across remount',
  async () => {
    api.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
    const { router } = mount();

    test.fireEvent.change(await test.screen.findByRole('textbox', { name: 'NoteCompose' }), {
      target: { value: 'Keep my note' }
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
    await test.screen.findByText('NoteCreationUncertain');
    await test.act(async () => {
      await router.navigate({ to: '/pages', search: { project: '1' } });
    });
    await test.act(async () => {
      await router.navigate({ to: '/notes', search: { project: '1' } });
    });
    test
      .expect(await test.screen.findByRole('textbox', { name: 'NoteCompose' }))
      .toHaveValue('Keep my note');
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    test.expect(test.screen.getByRole('button', { name: 'SidebarDismissDraft' })).toBeDisabled();
    test.expect(api.create).toHaveBeenCalledTimes(1);
  }
);
