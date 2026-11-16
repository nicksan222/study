import { noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { usePage } from './use-page';

const route = test.hoisted(() => ({ noteId: undefined as bigint | undefined }));

test.mock('@tanstack/react-router', () => ({
  useParams: () => route,
  useSearch: () => ({}),
  useNavigate: () => test.vi.fn()
}));

test.stable(
  'preserves validated identity beyond JavaScript number precision and clears it on index',
  () => {
    const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

    route.noteId = id;
    const fixture = test.rpcTestTransport(async () => new Promise(() => {}));
    const { result, rerender, unmount } = test.renderHook(usePage, { wrapper: fixture.wrapper });

    test.expect(result.current.id).toBe(id);
    route.noteId = undefined;
    rerender();
    test.expect(result.current.id).toBeUndefined();
    unmount();
  }
);
