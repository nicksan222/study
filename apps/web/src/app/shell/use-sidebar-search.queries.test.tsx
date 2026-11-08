import { projectIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import type { SearchInput } from '#web/lib/study-client/operations.ts';

import { useSidebarSearch } from './use-sidebar-search.queries';

const api = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock('#web/lib/study-client/study.queries.ts', () => ({
  searchQueryOptions: (input: SearchInput, enabled: boolean) => ({
    queryKey: ['search', { ...input, project: input.project?.toString() }],
    queryFn: () => api.search(input),
    enabled
  })
}));

const project = projectIdSchema.make(2n);

let cache: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  api.search.mockReset().mockResolvedValue({ hits: [] });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
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
