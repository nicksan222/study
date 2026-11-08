import { projectIdSchema } from '@study/contracts/ids';
import { summarySchema } from '@study/contracts/pages/schemas';
import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  stringifySearchWith,
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet
} from '@tanstack/react-router';
import { cleanup, screen, within, waitFor, act } from '@testing-library/react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { pagesOptions } from '#web/lib/study-client/pages.queries.ts';

import { PagesSidebar } from './pages-sidebar';

const api = vi.hoisted(() => ({ pages: vi.fn() }));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'pages.pages': api.pages,
      'settings.workspacePreferences': async () => defaultWorkspacePreferences
    })
}));

const en = catalogs.english;

const project = Schema.decodeUnknownSync(projectIdSchema)(1n);

const caches: QueryClient[] = [];

const document = (id: bigint, overrides: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(summarySchema)({
    id,
    title: `Document ${id}`,
    projectIds: [1n],
    description: `Description ${id}`,
    createdAt: 1n,
    updatedAt: id,
    archivedAt: null,
    headVersionId: id,
    ...overrides
  });

beforeEach(() => {
  api.pages.mockReset().mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  cleanup();
  caches.splice(0).forEach((cache) => cache.clear());
});

function show() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  caches.push(cache);
  const root = createRootRoute({
    component: () => (
      <>
        <PagesSidebar project={project} subjects={[]} />
        <Outlet />
      </>
    )
  });
  const index = createRoute({ getParentRoute: () => root, path: '/', component: () => null });
  const reader = createRoute({
    getParentRoute: () => root,
    path: '/pages/$pageId',
    component: () => <p>Reader</p>
  });
  const router = createRouter({
    stringifySearch: stringifySearchWith(String),
    routeTree: root.addChildren([index, reader]),
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  render(
    <QueryClientProvider client={cache}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return { cache, router };
}

testStable(
  'shows only published, unarchived pages for the subject and opens their reader',
  async () => {
    api.pages.mockResolvedValue({
      items: [
        document(1n),
        document(2n),
        document(3n, { headVersionId: null }),
        document(4n, { archivedAt: 5n }),
        document(5n, { projectIds: [2n] })
      ],
      nextCursor: null
    });
    const user = userEvent.setup();
    const { router, cache } = show();
    const newest = await screen.findByRole('link', { name: 'Document 2' });

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      expect.stringContaining('Document 2'),
      expect.stringContaining('Document 1')
    ]);
    expect(api.pages).toHaveBeenCalledWith({
      projectId: project,
      archived: false,
      limit: 30,
      cursor: undefined
    });
    expect(newest).toHaveClass('study-note-row');
    expect(within(newest).getByText('Description 2')).toBeInTheDocument();
    expect(newest).toHaveAttribute('href', '/pages/2?project=1');
    await user.click(newest);
    await waitFor(() => expect(router.state.location.pathname).toBe('/pages/2'));
    expect(screen.getByRole('link', { name: 'Document 2' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('navigation', { name: en.SourcePage })).toBeVisible();
    await act(async () => {
      cache.setQueryData(['workspace-preferences'], {
        ...defaultWorkspacePreferences,
        sidebarDensity: 'compact'
      });
    });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Document 2' })).toHaveAttribute(
        'data-layout',
        'compact'
      )
    );
  }
);

testStable(
  'shows an empty document list and picks up a newly published document on cache refresh',
  async () => {
    const { cache } = show();

    expect(await screen.findByText(en.PagesEmpty)).toBeInTheDocument();
    api.pages.mockResolvedValue({ items: [document(7n)], nextCursor: null });
    await act(async () => {
      await cache.invalidateQueries({ queryKey: pagesOptions(project).queryKey });
    });
    expect(await screen.findByRole('link', { name: 'Document 7' })).toBeInTheDocument();
    expect(screen.queryByText(en.PagesEmpty)).not.toBeInTheDocument();
  }
);

testStable('loads additional document pages without dropping the current rows', async () => {
  api.pages.mockImplementation(({ cursor }) =>
    Promise.resolve(
      cursor
        ? { items: [document(1n)], nextCursor: null }
        : { items: [document(2n)], nextCursor: 2n }
    )
  );
  const user = userEvent.setup();

  show();
  await screen.findByRole('link', { name: 'Document 2' });
  await user.click(screen.getByRole('button', { name: en.LibraryMore }));
  expect(await screen.findByRole('link', { name: 'Document 1' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Document 2' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: en.LibraryMore })).not.toBeInTheDocument();
});

testStable('keeps failed reads recoverable through retry', async () => {
  api.pages.mockRejectedValueOnce(new Error('offline'));
  const user = userEvent.setup();

  show();
  expect(await screen.findByText(en.PagesLoadError)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: en.Retry }));
  expect(await screen.findByText(en.PagesEmpty)).toBeInTheDocument();
  expect(screen.queryByText(en.PagesLoadError)).not.toBeInTheDocument();
});
