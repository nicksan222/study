import { noteSchema } from '@study/contracts/notes/schemas';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { NoteMergeDialog } from './merge';

const api = vi.hoisted(() => ({ merge: vi.fn(), navigate: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => api.navigate }));
vi.mock('#client/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({ 'notes.mergeNotes': api.merge })
}));
afterEach(cleanup);

testStable(
  'retries the reviewed note set with the same merge identity and opens the committed result',
  async () => {
    const note = Schema.decodeUnknownSync(noteSchema)({
      id: 3n,
      title: 'Combined',
      titleSource: 'provisional',
      projectIds: [],
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 1n
    });
    const first = Schema.decodeUnknownSync(noteSchema)({ ...note, id: 1n, title: 'First' });
    const second = Schema.decodeUnknownSync(noteSchema)({ ...note, id: 2n, title: 'Second' });
    const cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const onMerged = vi.fn();
    const onOpenChange = vi.fn();

    api.merge.mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce(note);

    try {
      render(
        <QueryClientProvider client={cache}>
          <NoteMergeDialog
            notes={[first, second]}
            onMerged={onMerged}
            onOpenChange={onOpenChange}
          />
        </QueryClientProvider>
      );
      fireEvent.click(screen.getByRole('button', { name: 'NoteMerge' }));
      await screen.findByText('NoteActionErrorTitle');
      expect(onMerged).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'NoteMerge' }));
      await waitFor(() => expect(onMerged).toHaveBeenCalledOnce());
      expect(api.merge).toHaveBeenCalledTimes(2);
      expect(api.merge.mock.calls[0]![0]).toEqual(api.merge.mock.calls[1]![0]);
      expect(api.merge.mock.calls[0]![0].noteIds).toEqual([1n, 2n]);
      expect(api.navigate).toHaveBeenCalledWith({
        to: '/notes/$noteId',
        params: { noteId: note.id },
        search: {}
      });
    } finally {
      cache.clear();
    }
  }
);
