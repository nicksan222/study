import { noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as NotePageModule from './use-page.ts';

let usePage: typeof NotePageModule.usePage;

let noteId: bigint | undefined;

test.beforeEach(async ({ mock }) => {
  noteId = undefined;
  mock('@tanstack/react-router', () => ({
    useParams: () => ({ noteId }),
    useSearch: () => ({}),
    useNavigate: () => mock.fn()
  }));
  ({ usePage } = await import('./use-page.ts'));
});

test.stable(
  'preserves validated identity beyond JavaScript number precision and clears it on index',
  () => {
    const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

    noteId = id;
    const fixture = test.rpcTestTransport(async () => new Promise(() => {}));
    const { result, rerender, unmount } = test.renderHook(usePage, { wrapper: fixture.wrapper });

    test.expect(result.current.id).toBe(id);
    noteId = undefined;
    rerender();
    test.expect(result.current.id).toBeUndefined();
    unmount();
  }
);
