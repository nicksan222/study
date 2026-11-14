import { projectIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { useSidebarSearch } from './use-sidebar-search.queries';

const api = vi.hoisted(() => ({ search: vi.fn() }));

const project = projectIdSchema.make(2n);

let cache: ReturnType<typeof rpcTestTransport>;

beforeEach(() => {
  vi.useFakeTimers();
  api.search.mockReset().mockResolvedValue({ hits: [] });
  cache = rpcTestTransport(async (_tag, input) => api.search(input));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <cache.wrapper>{children}</cache.wrapper>;
}

testStable(
  'debounces the latest query and keeps server search scoped to the selected subject',
  async () => {
    const view = renderHook(
      ({ query }) =>
        useSidebarSearch({ query, project, global: false, canSearch: true, content: 'workspace' }),
      { initialProps: { query: 'old' }, wrapper }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(api.search).not.toHaveBeenCalled();
    view.rerender({ query: ' newest ' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(api.search).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.search).toHaveBeenCalledExactlyOnceWith({
      query: 'newest',
      project,
      limit: 30,
      kinds: ['note', 'message']
    });
  }
);

testStable('cancels a pending debounce when its owner unmounts', async () => {
  const view = renderHook(
    () =>
      useSidebarSearch({
        query: 'notes',
        project,
        global: false,
        canSearch: true,
        content: 'workspace'
      }),
    { wrapper }
  );

  view.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(api.search).not.toHaveBeenCalled();
});

testStable(
  'leaves document filtering local and removes subject restrictions from global search',
  async () => {
    const view = renderHook(
      ({ content }) =>
        useSidebarSearch({ query: 'notes', project, global: true, canSearch: true, content }),
      { initialProps: { content: 'pages' as 'pages' | 'workspace' }, wrapper }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(api.search).not.toHaveBeenCalled();
    view.rerender({ content: 'workspace' });
    expect(api.search).toHaveBeenCalledExactlyOnceWith({
      query: 'notes',
      project: undefined,
      limit: 30
    });
  }
);
