import { noteIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { expect, vi } from 'vite-plus/test';

import { usePage } from './use-page';

const route = vi.hoisted(() => ({ noteId: undefined as bigint | undefined }));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => route,
  useSearch: () => ({}),
  useNavigate: () => vi.fn()
}));
vi.mock('#client/lib/study-client/request.ts', () => ({ request: () => new Promise(() => {}) }));

testStable(
  'preserves validated identity beyond JavaScript number precision and clears it on index',
  () => {
    const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

    route.noteId = id;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { result, rerender, unmount } = renderHook(usePage, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    });

    expect(result.current.id).toBe(id);
    route.noteId = undefined;
    rerender();
    expect(result.current.id).toBeUndefined();
    unmount();
    client.clear();
  }
);
