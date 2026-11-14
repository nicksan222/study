import { noteIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { renderHook } from '@testing-library/react';
import { Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { usePage } from './use-page';

const route = vi.hoisted(() => ({ noteId: undefined as bigint | undefined }));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => route,
  useSearch: () => ({}),
  useNavigate: () => vi.fn()
}));

testStable(
  'preserves validated identity beyond JavaScript number precision and clears it on index',
  () => {
    const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

    route.noteId = id;
    const fixture = rpcTestTransport(async () => new Promise(() => {}));
    const { result, rerender, unmount } = renderHook(usePage, { wrapper: fixture.wrapper });

    expect(result.current.id).toBe(id);
    route.noteId = undefined;
    rerender();
    expect(result.current.id).toBeUndefined();
    unmount();
  }
);
