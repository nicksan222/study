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

import { PagesSidebar } from './pages-sidebar';

const api = test.hoisted(() => ({ pages: test.vi.fn(), remove: test.vi.fn() }));

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

test.beforeEach(() => {
  preferences = defaultWorkspacePreferences;
  api.pages.mockReset().mockResolvedValue({ items: [], nextCursor: null });
});
test.afterEach(() => {
  test.cleanup();
});

function show() {
  const harness = test.rpcTestTransport(async (tag, input) => {
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
    path: '/pages/$pageId',
    component: () => <p>Reader</p>
  });
  const router = createRouter({
    stringifySearch: stringifySearchWith(String),
    routeTree: root.addChildren([index, reader]),
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  test.render(
    <harness.wrapper>
      <RouterProvider router={router} />
    </harness.wrapper>
  );

  return { notify: harness.notify, router };
}

test.stable(
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
    const user = test.userEvent.setup();
    const { router, notify } = show();
    const newest = await test.screen.findByRole('link', { name: /\bDocument 2\b/ });

    test
      .expect(test.screen.getAllByRole('link').map((link) => link.textContent))
      .toEqual([
        test.expect.stringContaining('Document 2'),
        test.expect.stringContaining('Document 1')
      ]);
    test.expect(api.pages).toHaveBeenCalledWith({
      projectId: project,
      archived: false,
      limit: 30,
      cursor: undefined
    });
    test.expect(newest).toHaveClass('study-note-row');
    test.expect(test.within(newest).getByText('Description 2')).toBeInTheDocument();
    test.expect(newest).toHaveAttribute('href', '/pages/2?project=1');
    await user.click(newest);
    await test.waitFor(() => test.expect(router.state.location.pathname).toBe('/pages/2'));
    test
      .expect(test.screen.getByRole('link', { name: /\bDocument 2\b/ }))
      .toHaveAttribute('aria-current', 'page');
    test.expect(test.screen.getByRole('navigation', { name: en.SourcePage })).toBeVisible();
    await test.act(async () => {
      preferences = { ...defaultWorkspacePreferences, sidebarDensity: 'compact' };
      await notify();
    });
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('link', { name: /\bDocument 2\b/ }))
        .toHaveAttribute('data-layout', 'compact')
    );
  }
);

test.stable(
  'shows an empty document list and picks up a newly published document after a server change hint',
  async () => {
    const { notify } = show();

    test.expect(await test.screen.findByText(en.PagesEmpty)).toBeInTheDocument();
    api.pages.mockResolvedValue({ items: [document(7n)], nextCursor: null });
    await test.act(async () => {
      await notify();
    });
    test
      .expect(await test.screen.findByRole('link', { name: /\bDocument 7\b/ }))
      .toBeInTheDocument();
    test.expect(test.screen.queryByText(en.PagesEmpty)).not.toBeInTheDocument();
  }
);

test.stable('loads additional document pages without dropping the current rows', async () => {
  api.pages.mockImplementation(({ limit }) =>
    Promise.resolve(
      limit > 30
        ? { items: [document(2n), document(1n)], nextCursor: null }
        : { items: [document(2n)], nextCursor: 2n }
    )
  );
  const user = test.userEvent.setup();

  show();
  await test.screen.findByRole('link', { name: /\bDocument 2\b/ });
  await user.click(test.screen.getByRole('button', { name: en.LibraryMore }));
  test.expect(await test.screen.findByRole('link', { name: /\bDocument 1\b/ })).toBeInTheDocument();
  test.expect(test.screen.getByRole('link', { name: /\bDocument 2\b/ })).toBeInTheDocument();
  test.expect(test.screen.queryByRole('button', { name: en.LibraryMore })).not.toBeInTheDocument();
});

test.stable('keeps failed reads recoverable through retry', async () => {
  api.pages.mockRejectedValueOnce(new Error('offline'));
  const user = test.userEvent.setup();

  show();
  test.expect(await test.screen.findByText(en.PagesLoadError)).toBeInTheDocument();
  await user.click(test.screen.getByRole('button', { name: en.Retry }));
  test.expect(await test.screen.findByText(en.PagesEmpty)).toBeInTheDocument();
  test.expect(test.screen.queryByText(en.PagesLoadError)).not.toBeInTheDocument();
});

test.stable(
  'browses beyond one hundred rows in bounded live windows and returns to the newest window',
  async () => {
    const items = Array.from({ length: 151 }, (_, index) => document(BigInt(151 - index)));

    api.pages.mockImplementation(({ limit, cursor }: { limit: number; cursor?: bigint }) => {
      const start = cursor === undefined ? 0 : items.findIndex((item) => item.id === cursor) + 1;
      const page = items.slice(start, start + limit);

      return Promise.resolve({
        items: page,
        nextCursor: start + limit < items.length ? (page.at(-1)?.id ?? null) : null
      });
    });
    const user = test.userEvent.setup();

    show();
    await test.screen.findByRole('link', { name: /\bDocument 151\b/ });

    for (const limit of [60, 90, 100]) {
      await user.click(test.screen.getByRole('button', { name: en.LibraryMore }));
      await test.waitFor(() =>
        test.expect(api.pages).toHaveBeenCalledWith(test.expect.objectContaining({ limit }))
      );
      await test.screen.findByRole('link', { name: new RegExp(`\\bDocument ${152 - limit}\\b`) });
    }

    await user.click(test.screen.getByRole('button', { name: en.LibraryMore }));
    await test.screen.findByRole('link', { name: /\bDocument 51\b/ });
    test.expect(test.screen.queryByRole('link', { name: /\bDocument 151\b/ })).toBeNull();
    await user.click(test.screen.getByRole('button', { name: en.LibraryPrevious }));
    await test.screen.findByRole('link', { name: /\bDocument 151\b/ });
    test.expect(test.screen.queryByRole('link', { name: /\bDocument 51\b/ })).toBeNull();
  }
);

test.stable(
  'a committed list replacement updates membership and ordering without duplicate rows',
  async () => {
    api.pages.mockResolvedValue({ items: [document(2n), document(1n)], nextCursor: null });
    const view = show();

    await test.screen.findByRole('link', { name: /\bDocument 1\b/ });
    api.pages.mockResolvedValue({
      items: [document(3n), document(2n, { title: 'Renamed page' })],
      nextCursor: null
    });
    await test.act(() => view.notify());
    await test.screen.findByRole('link', { name: /\bRenamed page\b/ });
    test.expect(test.screen.queryByRole('link', { name: /\bDocument 1\b/ })).toBeNull();
    test
      .expect(
        test.screen
          .getAllByRole('link')
          .map((link) => link.querySelector('.study-note-title')?.textContent)
      )
      .toEqual(['Document 3', 'Renamed page']);
  }
);

test.stable(
  'a committed cursor-anchor deletion resets the mounted window to a fresh authoritative first page',
  async () => {
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
    const user = test.userEvent.setup();

    show();
    await test.screen.findByRole('link', { name: /\bDocument 151\b/ });

    for (const limit of [60, 90, 100]) {
      await user.click(test.screen.getByRole('button', { name: en.LibraryMore }));
      await test.screen.findByRole('link', { name: new RegExp(`\\bDocument ${152 - limit}\\b`) });
    }

    await user.click(test.screen.getByRole('button', { name: en.LibraryMore }));
    await test.screen.findByRole('link', { name: /\bDocument 51\b/ });
    await test.act(() =>
      rpc.pages.delete.call({ pageId: document(52n).id, token: 'reviewed-anchor' })
    );
    await test.screen.findByRole('link', { name: /\bDocument 151\b/ });
    test.expect(test.screen.queryByRole('link', { name: /\bDocument 51\b/ })).toBeNull();
    test.expect(test.screen.queryByRole('button', { name: en.LibraryPrevious })).toBeNull();
    test.expect(api.remove).toHaveBeenCalledOnce();
  }
);
