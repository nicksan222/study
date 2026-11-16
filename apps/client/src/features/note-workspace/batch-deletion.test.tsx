import { StudyError, noteIdSchema } from '@study/contracts';
import type { NoteId } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from './deletion';

let NoteBatchDeleteDialog: typeof __MockType0.NoteBatchDeleteDialog;

let rpc: ReturnType<typeof createMockState>['rpc'];

const first = Schema.decodeUnknownSync(noteIdSchema)(1n);

const second = Schema.decodeUnknownSync(noteIdSchema)(2n);

const third = Schema.decodeUnknownSync(noteIdSchema)(3n);

const notes = [
  { id: first, title: 'First note' },
  { id: second, title: 'Second note' }
];

function createMockState(mock: test.Mock) {
  return {
    rpc: (() => ({ remove: mock.fn(), retry: mock.fn(), read: mock.fn() }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  rpc = __mockState.rpc;

  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english' })
  }));
  const __mockModule0 = await import('./deletion');

  NoteBatchDeleteDialog = __mockModule0.NoteBatchDeleteDialog;
});

test.afterEach(() => {
  test.cleanup();
  test.vi.resetAllMocks();
});

function mount(onDeleted = test.vi.fn()) {
  if (!rpc.read.getMockImplementation()) rpc.read.mockResolvedValue(null);

  const receipts = new Map<NoteId, unknown>();
  const fixture = test.rpcHandlersTransport({
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
  const close = test.vi.fn();
  const node = (selected = notes) => (
    <Provider>
      <NoteBatchDeleteDialog notes={selected} open onOpenChange={close} onDeleted={onDeleted} />
    </Provider>
  );

  return { ...test.render(node()), node, close, onDeleted };
}

test.stable('does not delete anything when batch confirmation is cancelled', async () => {
  mount();
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Cancel' }));
  test.expect(rpc.remove).not.toHaveBeenCalled();
});
test.stable(
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

    test.fireEvent.change(await test.screen.findByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteBatchConfirmDelete' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteBatchConfirmDelete' }));
    await test.waitFor(() => test.expect(rpc.remove).toHaveBeenCalledTimes(2));
    view.rerender(view.node([{ id: third, title: 'Another note' }]));
    test.expect(test.screen.getByText('Second note')).toBeVisible();
    test.expect(test.screen.queryByText('Another note')).toBeNull();
    await test.waitFor(() => test.expect(view.onDeleted).toHaveBeenCalledExactlyOnceWith([first]));
    test.expect(rpc.remove).not.toHaveBeenCalledWith(third);
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'Retry' }));
    await test.waitFor(() => test.expect(rpc.remove).toHaveBeenCalledTimes(3));
    test.expect(rpc.remove.mock.calls.map(([id]) => id)).toEqual([first, second, second]);
    await test.waitFor(() => test.expect(view.close).toHaveBeenCalledWith(false));
  }
);

test.stable(
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
    test.fireEvent.change(await test.screen.findByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteBatchConfirmDelete' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteBatchConfirmDelete' }));
    await test.waitFor(() => test.expect(rpc.remove).toHaveBeenCalledExactlyOnceWith(second));
  }
);
test.stable(
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

    await test.screen.findAllByText('NoteDeleting');
    test.expect(test.screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Cancel' }));
    test.expect(view.close).toHaveBeenCalledWith(false);
    test.expect(rpc.remove).not.toHaveBeenCalled();
  }
);
