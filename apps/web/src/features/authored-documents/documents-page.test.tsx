import { studyDocumentIdSchema, studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { DocumentsPage } from './documents-page';

const api = vi.hoisted(() => ({ documents: vi.fn() }));

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, date: () => 'today' })
}));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  Link: ({ children }: { children: ReactNode }) => <a href="/documents/1">{children}</a>
}));
vi.mock('#web/lib/study-client/documents.queries.ts', () => ({
  documentsOptions: (_project: unknown, archived: boolean) => ({
    queryKey: ['documents', archived],
    initialPageParam: undefined,
    queryFn: () => api.documents(archived),
    getNextPageParam: () => undefined
  })
}));
vi.mock('./creation-actions', () => ({ NewBlankDocument: () => null }));
vi.mock('./from-sessions', () => ({ DocumentsFromSessions: () => null }));
vi.mock('./document-context-menu', () => ({
  DocumentContextMenu: ({ children }: { children: ReactNode }) => children
}));
vi.mock('./merge', () => ({
  DocumentMerges: () => null,
  MergeDocumentsDialog: ({ documents }: { documents: { title: string }[] }) => (
    <section aria-label="Merge dialog">{documents.map((doc) => doc.title).join(', ')}</section>
  )
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

testStable('documents open directly without a selection button', async () => {
  const documents = [1n, 2n].map((id) => ({
    id: studyDocumentIdSchema.make(id),
    title: id === 1n ? 'First' : 'Second',
    description: null,
    headVersionId: studyDocumentVersionIdSchema.make(id),
    createdAt: 1n,
    updatedAt: 1n,
    archivedAt: null,
    projectIds: []
  }));

  api.documents.mockImplementation((archived: boolean) =>
    Promise.resolve({ items: archived ? [] : documents, nextCursor: null })
  );
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={cache}>
      <DocumentsPage />
    </QueryClientProvider>
  );
  await screen.findByText('First');
  expect(screen.queryByRole('button', { name: 'DocumentsSelect' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /First/ })).toBeVisible();
  cache.clear();
});

testStable(
  'archived documents can be browsed without selecting them for another merge',
  async () => {
    api.documents.mockResolvedValue({ items: [], nextCursor: null });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={cache}>
        <DocumentsPage />
      </QueryClientProvider>
    );
    await user.click(screen.getByRole('button', { name: 'DocumentsArchived' }));
    await screen.findByText('DocumentsArchivedEmpty');
    expect(api.documents).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: 'DocumentsSelect' })).not.toBeInTheDocument();
    cache.clear();
  }
);
