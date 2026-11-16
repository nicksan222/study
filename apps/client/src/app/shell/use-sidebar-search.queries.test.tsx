import { projectIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import type { ReactNode } from 'react';

import { useSidebarSearch } from './use-sidebar-search.queries';

function createMocks(mock: test.Mock) {
  return { search: mock.fn() };
}

let api: ReturnType<typeof createMocks>;

const project = projectIdSchema.make(2n);

let cache: ReturnType<test.Context['rpcTestTransport']>;

test.beforeEach(({ mock, vi, rpcTestTransport }) => {
  api = createMocks(mock);
  vi.useFakeTimers();
  api.search.mockResolvedValue({ hits: [] });
  cache = rpcTestTransport(async (_tag, input) => api.search(input));
});
test.afterEach(({ cleanup, vi }) => {
  cleanup();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <cache.wrapper>{children}</cache.wrapper>;
}

test.stable(
  'debounces the latest query and keeps server search scoped to the selected subject',
  async ({ renderHook, act, vi, expect }) => {
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

test.stable(
  'cancels a pending debounce when its owner unmounts',
  async ({ renderHook, act, vi, expect }) => {
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
  }
);

test.stable(
  'leaves document filtering local and removes subject restrictions from global search',
  async ({ renderHook, act, vi, expect }) => {
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
