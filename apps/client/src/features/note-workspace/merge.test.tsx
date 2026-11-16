import { noteSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from './merge';

let NoteMergeDialog: typeof __MockType0.NoteMergeDialog;

let api: ReturnType<typeof createMockState>['api'];

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ merge: mock.fn(), navigate: mock.fn() }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  mock('@tanstack/react-router', () => ({ useNavigate: () => api.navigate }));
  const __mockModule0 = await import('./merge');

  NoteMergeDialog = __mockModule0.NoteMergeDialog;
});

test.unit.afterEach(({ cleanup }) => cleanup());

test.unit.stable(
  'retries the reviewed note set with the same merge identity and opens the committed result',
  async ({ rpcTestTransport, vi, render, fireEvent, screen, expect, waitFor, cleanup }) => {
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
    const { wrapper: Provider } = rpcTestTransport(async (_tag, input) => api.merge(input));
    const onMerged = vi.fn();
    const onOpenChange = vi.fn();

    api.merge.mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce(note);

    try {
      render(
        <Provider>
          <NoteMergeDialog
            notes={[first, second]}
            onMerged={onMerged}
            onOpenChange={onOpenChange}
          />
        </Provider>
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
      cleanup();
    }
  }
);
