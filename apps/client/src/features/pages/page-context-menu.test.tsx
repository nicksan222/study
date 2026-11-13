import { projectIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, vi } from 'vite-plus/test';

import { authoredPage } from '../document-editing/test-support';
import { PageContextMenu } from './page-context-menu';

const api = vi.hoisted(() => ({ remove: vi.fn() }));

const document = authoredPage(5n, 'Text', 8n);

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#client/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'pages.page': async () => document,
      'pages.delete': api.remove
    })
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <PageContextMenu page={document} project={projectIdSchema.make(2n)}>
        <a href="/pages/5">Example document</a>
      </PageContextMenu>
    )
  });
  const reader = createRoute({
    getParentRoute: () => root,
    path: '/pages/$pageId',
    component: () => <p>Editor</p>
  });
  const router = createRouter({
    routeTree: root.addChildren([home, reader]),
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  render(
    <QueryClientProvider client={cache}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return cache;
}

testStable(
  'provides shared page actions and requires the existing delete confirmation before any removal',
  async () => {
    const cache = mount();

    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Example document' }));
    expect(await screen.findByRole('menuitem', { name: 'PageAskAI' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'PageRename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'ReaderHistory' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'PageDeleteAction' }));
    expect(
      await screen.findByRole('alertdialog', { name: 'AuthoredPageDelete' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AuthoredPageRetirementConfirm' })).toBeDisabled();
    expect(api.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.remove).not.toHaveBeenCalled();
    cache.clear();
  }
);
