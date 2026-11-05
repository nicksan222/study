import { sessionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { renderHook } from '@testing-library/react';
import { Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { usePage } from './use-page';

const route = vi.hoisted(() => ({ sessionId: undefined as bigint | undefined }));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => route,
  useSearch: () => ({}),
  useNavigate: () => vi.fn()
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  queryOptions: (options: unknown) => options
}));

testStable(
  'preserves validated identity beyond JavaScript number precision and clears it on index',
  () => {
    const id = Schema.decodeUnknownSync(sessionIdSchema)(9007199254740993n);

    route.sessionId = id;
    const { result, rerender } = renderHook(usePage);

    expect(result.current.id).toBe(id);
    route.sessionId = undefined;
    rerender();
    expect(result.current.id).toBeUndefined();
  }
);
