import { projectIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import type { ReactNode } from 'react';

import { useSidebarSearch } from './use-sidebar-search.queries';

function createMocks(mock: test.Mock) {
  return { search: mock.fn() };
}

let api: ReturnType<typeof createMocks>;

const project = projectIdSchema.make(2n);

let cache: ReturnType<test.unit.Context['rpcTestTransport']>;

test.unit.beforeEach(({ mock, vi, rpcTestTransport }) => {
  api = createMocks(mock);
  vi.useFakeTimers();
  api.search.mockResolvedValue({ hits: [] });
  cache = rpcTestTransport(async (_tag, input) => api.search(input));
});
test.unit.afterEach(({ cleanup, vi }) => {
  cleanup();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <cache.wrapper>{children}</cache.wrapper>;
}

test.unit.stable(
  'debounces the latest query and keeps server search scoped to the selected subject',
  async ({ renderHook, act, vi, expect }) => {
    const view = renderHook(
      ({ query }) =>
        useSidebarSearch({ query, project, global: false, canSearch: true, section: 'notes' }),
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

test.unit.stable(
  'cancels a pending debounce when its owner unmounts',
  async ({ renderHook, act, vi, expect }) => {
    const view = renderHook(
      () =>
        useSidebarSearch({
          query: 'notes',
          project,
          global: false,
          canSearch: true,
          section: 'notes'
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

test.unit.stable(
  'leaves document filtering local and removes subject restrictions from global search',
  async ({ renderHook, act, vi, expect }) => {
    const view = renderHook(
      ({ section }) =>
        useSidebarSearch({ query: 'notes', project, global: true, canSearch: true, section }),
      { initialProps: { section: 'practice' as 'practice' | 'notes' }, wrapper }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(api.search).not.toHaveBeenCalled();
    view.rerender({ section: 'notes' });
    expect(api.search).toHaveBeenCalledExactlyOnceWith({
      query: 'notes',
      project: undefined,
      limit: 30
    });
  }
);
