import { pageIdSchema, pageVersionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { PagesPage } from './pages-page';

const api = vi.hoisted(() => ({ pages: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, date: () => 'today' })
}));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  Link: ({ children }: { children: ReactNode }) => <a href="/pages/1">{children}</a>
}));
vi.mock('#client/lib/study-client/pages.queries.ts', () => ({
  pagesOptions: (_project: unknown, archived: boolean) => ({
    queryKey: ['pages', archived],
    initialPageParam: undefined,
    queryFn: () => api.pages(archived),
    getNextPageParam: () => undefined
  })
}));
vi.mock('./creation-actions', () => ({ NewBlankPage: () => null }));
vi.mock('./from-notes', () => ({ PagesFromNotes: () => null }));
vi.mock('./page-context-menu', () => ({
  PageContextMenu: ({ children }: { children: ReactNode }) => children
}));
vi.mock('./merge', () => ({
  PageMerges: () => null,
  MergePagesDialog: ({ pages }: { pages: { title: string }[] }) => (
    <section aria-label="Merge dialog">{pages.map((doc) => doc.title).join(', ')}</section>
  )
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

testStable('pages open directly without a selection button', async () => {
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
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={cache}>
      <PagesPage />
    </QueryClientProvider>
  );
  await screen.findByText('First');
  expect(screen.queryByRole('button', { name: 'PagesSelect' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /First/ })).toBeVisible();
  cache.clear();
});

testStable('archived pages can be browsed without selecting them for another merge', async () => {
  api.pages.mockResolvedValue({ items: [], nextCursor: null });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={cache}>
      <PagesPage />
    </QueryClientProvider>
  );
  await user.click(screen.getByRole('button', { name: 'PagesArchived' }));
  await screen.findByText('PagesArchivedEmpty');
  expect(api.pages).toHaveBeenCalledWith(true);
  expect(screen.queryByRole('button', { name: 'PagesSelect' })).not.toBeInTheDocument();
  cache.clear();
});
