import { StudyError } from '@study/contracts/errors';
import type { NoteId } from '@study/contracts/ids';
import { noteIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { NoteBatchDeleteDialog } from './deletion';
import type * as Queries from './note-workspace.queries';

const rpc = vi.hoisted(() => ({ remove: vi.fn(), retry: vi.fn(), read: vi.fn() }));

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
vi.mock('./note-workspace.queries', async (load) => ({
  ...(await load<typeof Queries>()),
  deletionOptions: (id: NoteId, enabled: boolean) => ({
    queryKey: ['batch-delete-test', String(id)],
    queryFn: () => rpc.read(id),
    enabled
  }),
  deleteNoteMutationOptions: (id: NoteId) => ({
    mutationFn: () => rpc.remove(id),
    retry: false
  }),
  retryNoteDeletionMutationOptions: (id: NoteId) => ({
    mutationFn: () => rpc.retry(id),
    retry: false
  })
}));

const first = Schema.decodeUnknownSync(noteIdSchema)(1n);

const second = Schema.decodeUnknownSync(noteIdSchema)(2n);

const third = Schema.decodeUnknownSync(noteIdSchema)(3n);

const notes = [
  { id: first, title: 'First note' },
  { id: second, title: 'Second note' }
];

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();

  for (const client of clients.splice(0)) client.clear();

  vi.resetAllMocks();
});

function mount(onDeleted = vi.fn()) {
  if (!rpc.read.getMockImplementation()) rpc.read.mockResolvedValue(null);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);
  const close = vi.fn();
  const node = (selected = notes) => (
    <QueryClientProvider client={client}>
      <NoteBatchDeleteDialog notes={selected} open onOpenChange={close} onDeleted={onDeleted} />
    </QueryClientProvider>
  );

  return { ...render(node()), node, client, close, onDeleted };
}

testStable('does not delete anything when batch confirmation is cancelled', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(rpc.remove).not.toHaveBeenCalled();
});
testStable(
  'keeps the reviewed selection fixed and retries only a failed note after a partial success',
  async () => {
    const receipt = (id: NoteId) => ({
      noteId: id,
      operationId: String(id),
      status: 'completed',
      errorKind: null,
      attempt: 1,
      completedAt: 1n
    });

    rpc.remove.mockImplementation(async (id: NoteId) => {
      if (
        id === second &&
        rpc.remove.mock.calls.filter(([called]) => called === second).length === 1
      )
        throw new StudyError('invalid_input', 'Rejected before commit');

      return receipt(id);
    });
    const view = mount();

    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteBatchConfirmDelete' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteBatchConfirmDelete' }));
    await waitFor(() => expect(rpc.remove).toHaveBeenCalledTimes(2));
    view.rerender(view.node([{ id: third, title: 'Another note' }]));
    expect(screen.getByText('Second note')).toBeVisible();
    expect(screen.queryByText('Another note')).toBeNull();
    await waitFor(() => expect(view.onDeleted).toHaveBeenCalledExactlyOnceWith([first]));
    expect(rpc.remove).not.toHaveBeenCalledWith(third);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rpc.remove).toHaveBeenCalledTimes(3));
    expect(rpc.remove.mock.calls.map(([id]) => id)).toEqual([first, second, second]);
    await waitFor(() => expect(view.close).toHaveBeenCalledWith(false));
  }
);

testStable(
  'treats an already completed target as satisfied and deletes only the remaining target',
  async () => {
    const receipt = {
      noteId: first,
      operationId: 'already-deleted',
      status: 'completed',
      errorKind: null,
      attempt: 1,
      completedAt: 1n
    };

    rpc.read.mockImplementation(async (id: NoteId) => (id === first ? receipt : null));
    rpc.remove.mockResolvedValue({ ...receipt, noteId: second, operationId: 'second' });
    mount();
    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteBatchConfirmDelete' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteBatchConfirmDelete' }));
    await waitFor(() => expect(rpc.remove).toHaveBeenCalledExactlyOnceWith(second));
  }
);
testStable(
  'allows cancelling before confirmation when another deletion is already pending',
  async () => {
    rpc.read.mockResolvedValue({
      noteId: first,
      operationId: 'external',
      status: 'pending',
      errorKind: null,
      attempt: 1,
      completedAt: null
    });
    const view = mount();

    await screen.findAllByText('NoteDeleting');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(view.close).toHaveBeenCalledWith(false);
    expect(rpc.remove).not.toHaveBeenCalled();
  }
);
