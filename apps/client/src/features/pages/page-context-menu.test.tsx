import { projectIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet
} from '@tanstack/react-router';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './page-context-menu';

let authoredPage: typeof __MockType0.authoredPage;

let PageContextMenu: typeof __MockType1.PageContextMenu;

let api: ReturnType<typeof createMockState>['api'];

function initializeDocument() {
  return authoredPage(5n, 'Text', 8n);
}

let document: ReturnType<typeof initializeDocument>;

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ remove: mock.fn() }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule1 = await import('./page-context-menu');

  PageContextMenu = __mockModule1.PageContextMenu;
  document = initializeDocument();
});

test.unit.afterEach(({ cleanup, vi }) => {
  cleanup();
  vi.resetAllMocks();
});

function mount({
  rpcTestTransport,
  render
}: Pick<test.unit.Context, 'rpcTestTransport' | 'render'>) {
  const harness = rpcTestTransport(async (tag, input) => {
    if (tag === 'pages.page') return document;

    if (tag === 'pages.delete') return api.remove(input);

    throw new Error(tag);
  });
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <PageContextMenu page={document} project={projectIdSchema.make(2n)}>
        <a href="/practice/study-notes/5">Example document</a>
      </PageContextMenu>
    )
  });
  const reader = createRoute({
    getParentRoute: () => root,
    path: '/practice/study-notes/$pageId',
    component: () => <p>Editor</p>
  });
  const router = createRouter({
    routeTree: root.addChildren([home, reader]),
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  render(
    <harness.wrapper>
      <RouterProvider router={router} />
    </harness.wrapper>
  );

  return harness;
}

test.unit.stable(
  'provides shared page actions and requires the existing delete confirmation before any removal',
  async ({ fireEvent, screen, expect, userEvent, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render });

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
  }
);
