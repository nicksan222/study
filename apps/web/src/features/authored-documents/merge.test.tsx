import { studyDocumentIdSchema, studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, vi } from 'vite-plus/test';

import { MergeDocumentsDialog } from './merge';

const api = vi.hoisted(() => ({ merge: vi.fn() }));
vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'italian' })
}));
vi.mock('./merge.queries', () => ({ mergeDocumentsOptions: () => ({ mutationFn: api.merge }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

testStable(
  'merge explains archival, requires a title and submits selected exact versions in the UI language',
  async () => {
    const user = userEvent.setup();
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const close = vi.fn();
    api.merge.mockResolvedValue({ id: 'document/merge/test' });
    const documents = [1n, 2n].map((id) => ({
      id: studyDocumentIdSchema.make(id),
      title: `Document ${id}`,
      description: null,
      headVersionId: studyDocumentVersionIdSchema.make(id + 10n),
      createdAt: 1n,
      updatedAt: 1n,
      archivedAt: null,
      projectIds: []
    }));
    render(
      <QueryClientProvider client={cache}>
        <MergeDocumentsDialog documents={documents} onClose={close} />
      </QueryClientProvider>
    );
    expect(screen.getByText('DocumentsMergeHelp')).toBeInTheDocument();
    expect(screen.getByText('Document 1')).toBeInTheDocument();
    expect(screen.getByText('Document 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DocumentsMerge' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'DocumentsMergeTitle' }), 'Combined notes');
    await user.type(
      screen.getByRole('textbox', { name: 'DocumentsMergeInstruction' }),
      'Keep the examples'
    );
    await user.click(screen.getByRole('button', { name: 'DocumentsMerge' }));
    await waitFor(() =>
      expect(api.merge).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Combined notes',
          instruction: 'Keep the examples',
          versions: [11n, 12n],
          language: 'italian'
        }),
        expect.anything()
      )
    );
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    cache.clear();
  }
);
