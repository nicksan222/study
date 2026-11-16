import { StudyError, noteSchema, defaultWorkspacePreferences } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { SidebarNoteDrafts } from '#client/app/shell/sidebar-note-drafts.tsx';
import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { NoteStart } from './start';
import { startDraftKey, startDraft, startDrafts } from './start-drafts.queries';

const api = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('./workspace-context', () => ({ WorkspaceContext: () => null }));

const clients: AtomRegistry.AtomRegistry[] = [];

function mount() {
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

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((cache) => cache.dispose());
});

testStable(
  'opening, typing and switching subjects only cache drafts until first send',
  async () => {
    const { cache, router } = mount();
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

testStable('first send creates once, consumes its draft, and preserves later typing', async () => {
  let resolve!: (value: unknown) => void;

  api.create.mockImplementation(
    () =>
      new Promise((accept) => {
        resolve = accept;
      })
  );
  const { cache } = mount();
  const input = await screen.findByRole('textbox', { name: 'NoteCompose' });

  fireEvent.change(input, { target: { value: 'Lecture notes' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
  await waitFor(() =>
    expect(api.create).toHaveBeenCalledExactlyOnceWith(1n, { text: 'Lecture notes', sourceIds: [] })
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
});

testStable(
  'lost creation receipts retain the draft and prevent duplicate creation across remount',
  async () => {
    api.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
    const { router } = mount();

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
