import { pageIdSchema, pageVersionIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import type { ReactNode } from 'react';

import type * as __MockType0 from './pages-page';

let PagesPage: typeof __MockType0.PagesPage;

let api: ReturnType<typeof createMockState>['api'];

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ pages: mock.fn() }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, date: () => 'today' })
  }));
  mock('@tanstack/react-router', () => ({
    useSearch: () => ({}),
    Link: ({ children }: { children: ReactNode }) => <a href="/pages/1">{children}</a>
  }));
  mock('#client/features/pages/creation-actions', () => ({ NewBlankPage: () => null }));
  mock('#client/features/pages/from-notes', () => ({ PagesFromNotes: () => null }));
  mock('#client/features/pages/page-context-menu', () => ({
    PageContextMenu: ({ children }: { children: ReactNode }) => children
  }));
  mock('#client/features/pages/merge', () => ({
    PageMerges: () => null,
    MergePagesDialog: ({ pages }: { pages: { title: string }[] }) => (
      <section aria-label="Merge dialog">{pages.map((doc) => doc.title).join(', ')}</section>
    )
  }));
  const __mockModule0 = await import('./pages-page');

  PagesPage = __mockModule0.PagesPage;
});

test.afterEach(() => {
  test.cleanup();
  test.vi.clearAllMocks();
});

test.stable('pages open directly without a selection button', async () => {
  const pages = [1n, 2n].map((id) => ({
    id: pageIdSchema.make(id),
    title: id === 1n ? 'First' : 'Second',
    description: null,
    headVersionId: pageVersionIdSchema.make(id),
    createdAt: 1n,
    updatedAt: 1n,
    archivedAt: null,
    projectIds: []
  }));

  api.pages.mockImplementation((archived: boolean) =>
    Promise.resolve({ items: archived ? [] : pages, nextCursor: null })
  );
  const harness = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'pages.pages')
      return api.pages(
        typeof input === 'object' && input !== null && 'archived' in input ? input.archived : false
      );

    throw new Error(tag);
  });

  test.render(
    <harness.wrapper>
      <PagesPage />
    </harness.wrapper>
  );
  await test.screen.findByText('First');
  test.expect(test.screen.queryByRole('button', { name: 'PagesSelect' })).not.toBeInTheDocument();
  test.expect(test.screen.getByRole('link', { name: /First/ })).toBeVisible();
});

test.stable('archived pages can be browsed without selecting them for another merge', async () => {
  api.pages.mockResolvedValue({ items: [], nextCursor: null });
  const harness = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'pages.pages')
      return api.pages(
        typeof input === 'object' && input !== null && 'archived' in input ? input.archived : false
      );

    throw new Error(tag);
  });
  const user = test.userEvent.setup();

  test.render(
    <harness.wrapper>
      <PagesPage />
    </harness.wrapper>
  );
  await user.click(test.screen.getByRole('button', { name: 'PagesArchived' }));
  await test.screen.findByText('PagesArchivedEmpty');
  test.expect(api.pages).toHaveBeenCalledWith(true);
  test.expect(test.screen.queryByRole('button', { name: 'PagesSelect' })).not.toBeInTheDocument();
});
