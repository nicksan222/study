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

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  mock('@tanstack/react-router', () => ({ useNavigate: () => api.navigate }));
  const __mockModule0 = await import('./merge');

  NoteMergeDialog = __mockModule0.NoteMergeDialog;
});

test.afterEach(test.cleanup);

test.stable(
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
    const { wrapper: Provider } = test.rpcTestTransport(async (_tag, input) => api.merge(input));
    const onMerged = test.vi.fn();
    const onOpenChange = test.vi.fn();

    api.merge.mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce(note);

    try {
      test.render(
        <Provider>
          <NoteMergeDialog
            notes={[first, second]}
            onMerged={onMerged}
            onOpenChange={onOpenChange}
          />
        </Provider>
      );
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteMerge' }));
      await test.screen.findByText('NoteActionErrorTitle');
      test.expect(onMerged).not.toHaveBeenCalled();
      test.expect(onOpenChange).not.toHaveBeenCalled();
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteMerge' }));
      await test.waitFor(() => test.expect(onMerged).toHaveBeenCalledOnce());
      test.expect(api.merge).toHaveBeenCalledTimes(2);
      test.expect(api.merge.mock.calls[0]![0]).toEqual(api.merge.mock.calls[1]![0]);
      test.expect(api.merge.mock.calls[0]![0].noteIds).toEqual([1n, 2n]);
      test.expect(api.navigate).toHaveBeenCalledWith({
        to: '/notes/$noteId',
        params: { noteId: note.id },
        search: {}
      });
    } finally {
      test.cleanup();
    }
  }
);
