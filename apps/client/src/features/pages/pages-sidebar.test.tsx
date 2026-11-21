import {
  StudyError,
  projectIdSchema,
  summarySchema,
  defaultWorkspacePreferences
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import {
  stringifySearchWith,
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet
} from '@tanstack/react-router';
import { Schema } from 'effect';

import type * as __MockType0 from './pages-sidebar';

let PagesSidebar: typeof __MockType0.PagesSidebar;

let api: ReturnType<typeof createMockState>['api'];

const en = catalogs.english;

const project = Schema.decodeUnknownSync(projectIdSchema)(1n);

let preferences = defaultWorkspacePreferences;

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

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ pages: mock.fn(), remove: mock.fn() }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  const __mockModule0 = await import('./pages-sidebar');

  PagesSidebar = __mockModule0.PagesSidebar;
});

test.unit.beforeEach(() => {
  preferences = defaultWorkspacePreferences;
  api.pages.mockReset().mockResolvedValue({ items: [], nextCursor: null });
});
test.unit.afterEach(({ cleanup }) => {
  cleanup();
});

function show({
  rpcTestTransport,
  render
}: Pick<test.unit.Context, 'rpcTestTransport' | 'render'>) {
  const harness = rpcTestTransport(async (tag, input) => {
    if (tag === 'pages.pages') return api.pages(input);

    if (tag === 'pages.delete') return api.remove(input);

    if (tag === 'settings.workspacePreferences') return preferences;

    throw new Error(tag);
  });

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
    path: '/practice/study-notes/$pageId',
    component: () => <p>Reader</p>
  });
  const router = createRouter({
    stringifySearch: stringifySearchWith(String),
    routeTree: root.addChildren([index, reader]),
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  render(
    <harness.wrapper>
      <RouterProvider router={router} />
    </harness.wrapper>
  );

  return { notify: harness.notify, router };
}

test.unit.stable(
  'shows only published, unarchived pages for the subject and opens their reader',
  async ({ userEvent, screen, expect, within, waitFor, act, rpcTestTransport, render }) => {
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
    const { router, notify } = show({ rpcTestTransport, render });
    const newest = await screen.findByRole('link', { name: /\bDocument 2\b/ });

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
    expect(newest).toHaveAttribute('href', '/practice/study-notes/2?project=1');
    await user.click(newest);
    await waitFor(() => expect(router.state.location.pathname).toBe('/practice/study-notes/2'));
    expect(screen.getByRole('link', { name: /\bDocument 2\b/ })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('navigation', { name: en.SourcePage })).toBeVisible();
    await act(async () => {
      preferences = { ...defaultWorkspacePreferences, sidebarDensity: 'compact' };
      await notify();
    });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /\bDocument 2\b/ })).toHaveAttribute(
        'data-layout',
        'compact'
      )
    );
  }
);

test.unit.stable(
  'shows an empty document list and picks up a newly published document after a server change hint',
  async ({ expect, screen, act, rpcTestTransport, render }) => {
    const { notify } = show({ rpcTestTransport, render });

    expect(await screen.findByText(en.PagesEmpty)).toBeInTheDocument();
    api.pages.mockResolvedValue({ items: [document(7n)], nextCursor: null });
    await act(async () => {
      await notify();
    });
    expect(await screen.findByRole('link', { name: /\bDocument 7\b/ })).toBeInTheDocument();
    expect(screen.queryByText(en.PagesEmpty)).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'loads additional document pages without dropping the current rows',
  async ({ userEvent, screen, expect, rpcTestTransport, render }) => {
    api.pages.mockImplementation(({ limit }) =>
      Promise.resolve(
        limit > 30
          ? { items: [document(2n), document(1n)], nextCursor: null }
          : { items: [document(2n)], nextCursor: 2n }
      )
    );
    const user = userEvent.setup();

    show({ rpcTestTransport, render });
    await screen.findByRole('link', { name: /\bDocument 2\b/ });
    await user.click(screen.getByRole('button', { name: en.LibraryMore }));
    expect(await screen.findByRole('link', { name: /\bDocument 1\b/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\bDocument 2\b/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.LibraryMore })).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'keeps failed reads recoverable through retry',
  async ({ userEvent, expect, screen, rpcTestTransport, render }) => {
    api.pages.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();

    show({ rpcTestTransport, render });
    expect(await screen.findByText(en.PagesLoadError)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.Retry }));
    expect(await screen.findByText(en.PagesEmpty)).toBeInTheDocument();
    expect(screen.queryByText(en.PagesLoadError)).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'browses beyond one hundred rows in bounded live windows and returns to the newest window',
  async ({ userEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    const items = Array.from({ length: 151 }, (_, index) => document(BigInt(151 - index)));

    api.pages.mockImplementation(({ limit, cursor }: { limit: number; cursor?: bigint }) => {
      const start = cursor === undefined ? 0 : items.findIndex((item) => item.id === cursor) + 1;
      const page = items.slice(start, start + limit);

      return Promise.resolve({
        items: page,
        nextCursor: start + limit < items.length ? (page.at(-1)?.id ?? null) : null
      });
    });
    const user = userEvent.setup();

    show({ rpcTestTransport, render });
    await screen.findByRole('link', { name: /\bDocument 151\b/ });

    for (const limit of [60, 90, 100]) {
      await user.click(screen.getByRole('button', { name: en.LibraryMore }));
      await waitFor(() =>
        expect(api.pages).toHaveBeenCalledWith(expect.objectContaining({ limit }))
      );
      await screen.findByRole('link', { name: new RegExp(`\\bDocument ${152 - limit}\\b`) });
    }

    await user.click(screen.getByRole('button', { name: en.LibraryMore }));
    await screen.findByRole('link', { name: /\bDocument 51\b/ });
    expect(screen.queryByRole('link', { name: /\bDocument 151\b/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: en.LibraryPrevious }));
    await screen.findByRole('link', { name: /\bDocument 151\b/ });
    expect(screen.queryByRole('link', { name: /\bDocument 51\b/ })).toBeNull();
  }
);

test.unit.stable(
  'a committed list replacement updates membership and ordering without duplicate rows',
  async ({ screen, act, expect, rpcTestTransport, render }) => {
    api.pages.mockResolvedValue({ items: [document(2n), document(1n)], nextCursor: null });
    const view = show({ rpcTestTransport, render });

    await screen.findByRole('link', { name: /\bDocument 1\b/ });
    api.pages.mockResolvedValue({
      items: [document(3n), document(2n, { title: 'Renamed page' })],
      nextCursor: null
    });
    await act(() => view.notify());
    await screen.findByRole('link', { name: /\bRenamed page\b/ });
    expect(screen.queryByRole('link', { name: /\bDocument 1\b/ })).toBeNull();
    expect(
      screen
        .getAllByRole('link')
        .map((link) => link.querySelector('.study-note-title')?.textContent)
    ).toEqual(['Document 3', 'Renamed page']);
  }
);

test.unit.stable(
  'a committed cursor-anchor deletion resets the mounted window to a fresh authoritative first page',
  async ({ userEvent, screen, act, expect, rpcTestTransport, render }) => {
    let items = Array.from({ length: 151 }, (_, index) => document(BigInt(151 - index)));
    const removed = new Set<bigint>();

    api.pages.mockImplementation(({ limit, cursor }: { limit: number; cursor?: bigint }) => {
      if (cursor !== undefined && removed.has(cursor))
        return Promise.reject(new StudyError('not_found', 'Cursor unavailable'));

      const start = cursor === undefined ? 0 : items.findIndex((item) => item.id === cursor) + 1;
      const page = items.slice(start, start + limit);

      return Promise.resolve({
        items: page,
        nextCursor: start + limit < items.length ? (page.at(-1)?.id ?? null) : null
      });
    });
    api.remove.mockImplementation(async ({ pageId }: { pageId: bigint }) => {
      removed.add(pageId);
      items = items.filter((item) => item.id !== pageId);
    });
    const user = userEvent.setup();

    show({ rpcTestTransport, render });
    await screen.findByRole('link', { name: /\bDocument 151\b/ });

    for (const limit of [60, 90, 100]) {
      await user.click(screen.getByRole('button', { name: en.LibraryMore }));
      await screen.findByRole('link', { name: new RegExp(`\\bDocument ${152 - limit}\\b`) });
    }

    await user.click(screen.getByRole('button', { name: en.LibraryMore }));
    await screen.findByRole('link', { name: /\bDocument 51\b/ });
    await act(() => rpc.pages.delete.call({ pageId: document(52n).id, token: 'reviewed-anchor' }));
    await screen.findByRole('link', { name: /\bDocument 151\b/ });
    expect(screen.queryByRole('link', { name: /\bDocument 51\b/ })).toBeNull();
    expect(screen.queryByRole('button', { name: en.LibraryPrevious })).toBeNull();
    expect(api.remove).toHaveBeenCalledOnce();
  }
);
