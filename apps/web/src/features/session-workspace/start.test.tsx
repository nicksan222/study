import { sessionSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { WorkspaceCard } from '@study/ui/workspace';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { SidebarSessionDrafts } from '#web/app/shell/sidebar-session-drafts.tsx';

import { SessionStart } from './start';
import { startDraftKey, startDraftsOptions } from './start-drafts.queries';

const api = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('./workspace-context', () => ({ WorkspaceContext: () => null }));
vi.mock('#web/lib/study-client/operations.ts', async (load) => ({
  ...(await load<object>()),
  createSession: api.create,
  listProjects: async () => []
}));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => unknown) =>
    invoke({
      'conversations.sessions': async () => ({ items: [], next: null }),
      'settings.workspacePreferences': async () => defaultWorkspacePreferences
    })
}));

const clients: QueryClient[] = [];

function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  clients.push(cache);
  const root = createRootRoute({
    validateSearch: (search: Record<string, unknown>) => ({
      project: typeof search.project === 'string' ? search.project : undefined
    }),
    component: () => (
      <>
        <SidebarSessionDrafts subjects={[]} project={undefined} />
        <Outlet />
      </>
    )
  });
  const start = createRoute({
    getParentRoute: () => root,
    path: '/sessions',
    component: () => (
      <WorkspaceCard.Provider>
        <SessionStart />
      </WorkspaceCard.Provider>
    )
  });
  const saved = createRoute({
    getParentRoute: () => root,
    path: '/sessions/$sessionId',
    component: () => <p>Saved session</p>
  });
  const documents = createRoute({
    getParentRoute: () => root,
    path: '/documents',
    component: () => <p>Documents</p>
  });
  const router = createRouter({
    parseSearch: (value) => Object.fromEntries(new URLSearchParams(value)),
    stringifySearch: stringifySearchWith(String),
    routeTree: root.addChildren([start, saved, documents]),
    history: createMemoryHistory({ initialEntries: ['/sessions?project=1'] })
  });
  const view = render(
    <QueryClientProvider client={cache}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return { cache, router, ...view };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((cache) => cache.clear());
});

testStable(
  'opening, typing and switching subjects only cache drafts until first send',
  async () => {
    const { cache, router } = mount();
    const input = await screen.findByRole('textbox', { name: 'SessionCompose' });

    fireEvent.change(input, { target: { value: 'Math draft' } });
    await act(async () => {
      await router.navigate({ to: '/sessions', search: { project: '2' } });
    });
    expect(screen.getByRole('textbox', { name: 'SessionCompose' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'SessionCompose' }), {
      target: { value: 'History draft' }
    });
    await act(async () => {
      await router.navigate({ to: '/sessions', search: { project: '1' } });
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'SessionCompose' })).toHaveValue('Math draft')
    );
    expect(cache.getQueryData(startDraftsOptions().queryKey)).toEqual(['2', '1']);
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'SidebarDismissDraft' })[1]!);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'SessionCompose' })).toHaveValue('')
    );
    expect(cache.getQueryData(startDraftKey('1'))).toBe('');
    expect(cache.getQueryData(startDraftKey('2'))).toBe('History draft');
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
  const input = await screen.findByRole('textbox', { name: 'SessionCompose' });

  fireEvent.change(input, { target: { value: 'Lecture notes' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
  await waitFor(() =>
    expect(api.create).toHaveBeenCalledExactlyOnceWith(1n, { text: 'Lecture notes', sourceIds: [] })
  );
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  fireEvent.change(input, { target: { value: 'Newer notes' } });
  await act(async () =>
    resolve(
      Schema.decodeUnknownSync(sessionSchema)({
        id: 10n,
        title: 'Lecture',
        titleSource: 'user',
        projectIds: [1n],
        createdAt: 1n,
        updatedAt: 1n
      })
    )
  );
  await screen.findByText('Saved session');
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(cache.getQueryData(startDraftKey('1'))).toBe('Newer notes');
  expect(cache.getQueryData(startDraftsOptions().queryKey)).toEqual(['1']);
});

testStable(
  'lost creation receipts retain the draft and prevent duplicate creation across remount',
  async () => {
    api.create.mockRejectedValue(new StudyError('transient', 'Receipt lost'));
    const { router } = mount();

    fireEvent.change(await screen.findByRole('textbox', { name: 'SessionCompose' }), {
      target: { value: 'Keep my note' }
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
    await screen.findByText('SessionCreationUncertain');
    await act(async () => {
      await router.navigate({ to: '/documents', search: { project: '1' } });
    });
    await act(async () => {
      await router.navigate({ to: '/sessions', search: { project: '1' } });
    });
    expect(await screen.findByRole('textbox', { name: 'SessionCompose' })).toHaveValue(
      'Keep my note'
    );
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'SidebarDismissDraft' })).toBeDisabled();
    expect(api.create).toHaveBeenCalledTimes(1);
  }
);
