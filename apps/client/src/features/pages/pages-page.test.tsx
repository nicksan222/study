import { pageIdSchema, pageVersionIdSchema } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { PagesPage } from './pages-page';

const api = vi.hoisted(() => ({ pages: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, date: () => 'today' })
}));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  Link: ({ children }: { children: ReactNode }) => <a href="/pages/1">{children}</a>
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
  const harness = rpcTestTransport(async (tag, input) => {
    if (tag === 'pages.pages')
      return api.pages(
        typeof input === 'object' && input !== null && 'archived' in input ? input.archived : false
      );

    throw new Error(tag);
  });

  render(
    <harness.wrapper>
      <PagesPage />
    </harness.wrapper>
  );
  await screen.findByText('First');
  expect(screen.queryByRole('button', { name: 'PagesSelect' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /First/ })).toBeVisible();
});

testStable('archived pages can be browsed without selecting them for another merge', async () => {
  api.pages.mockResolvedValue({ items: [], nextCursor: null });
  const harness = rpcTestTransport(async (tag, input) => {
    if (tag === 'pages.pages')
      return api.pages(
        typeof input === 'object' && input !== null && 'archived' in input ? input.archived : false
      );

    throw new Error(tag);
  });
  const user = userEvent.setup();

  render(
    <harness.wrapper>
      <PagesPage />
    </harness.wrapper>
  );
  await user.click(screen.getByRole('button', { name: 'PagesArchived' }));
  await screen.findByText('PagesArchivedEmpty');
  expect(api.pages).toHaveBeenCalledWith(true);
  expect(screen.queryByRole('button', { name: 'PagesSelect' })).not.toBeInTheDocument();
});
