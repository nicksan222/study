import { StudyError, noteIdSchema } from '@study/contracts';
import type { NoteId } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { NoteBatchDeleteDialog } from './deletion';

const rpc = vi.hoisted(() => ({ remove: vi.fn(), retry: vi.fn(), read: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));

const first = Schema.decodeUnknownSync(noteIdSchema)(1n);

const second = Schema.decodeUnknownSync(noteIdSchema)(2n);

const third = Schema.decodeUnknownSync(noteIdSchema)(3n);

const notes = [
  { id: first, title: 'First note' },
  { id: second, title: 'Second note' }
];

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function mount(onDeleted = vi.fn()) {
  if (!rpc.read.getMockImplementation()) rpc.read.mockResolvedValue(null);

  const receipts = new Map<NoteId, unknown>();
  const fixture = rpcHandlersTransport({
    'notes.noteDeletion': async ({ id }) => {
      const value = receipts.get(id) ?? (await rpc.read(id));

      if (value == null) throw new StudyError('not_found', 'No deletion');

      return value;
    },
    'notes.deleteNote': async ({ id }) => {
      const value = await rpc.remove(id);

      receipts.set(id, value);

      return value;
    },
    'notes.retryNoteDeletion': async ({ id }) => {
      const value = await rpc.retry(id);

      receipts.set(id, value);

      return value;
    }
  });
  const Provider = fixture.wrapper;
  const close = vi.fn();
  const node = (selected = notes) => (
    <Provider>
      <NoteBatchDeleteDialog notes={selected} open onOpenChange={close} onDeleted={onDeleted} />
    </Provider>
  );

  return { ...render(node()), node, close, onDeleted };
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
