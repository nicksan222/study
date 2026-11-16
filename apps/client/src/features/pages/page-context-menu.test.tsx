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

import { authoredPage } from '../document-editing/test-support';
import { PageContextMenu } from './page-context-menu';

const api = test.hoisted(() => ({ remove: test.vi.fn() }));

const document = authoredPage(5n, 'Text', 8n);

test.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

test.afterEach(() => {
  test.cleanup();
  test.vi.resetAllMocks();
});

function mount() {
  const harness = test.rpcTestTransport(async (tag, input) => {
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

  test.render(
    <harness.wrapper>
      <RouterProvider router={router} />
    </harness.wrapper>
  );

  return harness;
}

test.stable(
  'provides shared page actions and requires the existing delete confirmation before any removal',
  async () => {
    mount();

    test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: 'Example document' }));
    test.expect(await test.screen.findByRole('menuitem', { name: 'PageAskAI' })).toBeEnabled();
    test.expect(test.screen.getByRole('menuitem', { name: 'PageRename' })).toBeInTheDocument();
    test.expect(test.screen.getByRole('menuitem', { name: 'ReaderHistory' })).toBeInTheDocument();
    await test.userEvent.click(test.screen.getByRole('menuitem', { name: 'PageDeleteAction' }));
    test
      .expect(await test.screen.findByRole('alertdialog', { name: 'AuthoredPageDelete' }))
      .toBeInTheDocument();
    test
      .expect(test.screen.getByRole('button', { name: 'AuthoredPageRetirementConfirm' }))
      .toBeDisabled();
    test.expect(api.remove).not.toHaveBeenCalled();
    await test.userEvent.click(test.screen.getByRole('button', { name: 'Cancel' }));
    test.expect(api.remove).not.toHaveBeenCalled();
  }
);
