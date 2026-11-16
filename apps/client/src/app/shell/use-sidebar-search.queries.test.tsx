import { projectIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import type { ReactNode } from 'react';

import { useSidebarSearch } from './use-sidebar-search.queries';

const api = test.hoisted(() => ({ search: test.vi.fn() }));

const project = projectIdSchema.make(2n);

let cache: ReturnType<typeof test.rpcTestTransport>;

test.beforeEach(() => {
  test.vi.useFakeTimers();
  api.search.mockReset().mockResolvedValue({ hits: [] });
  cache = test.rpcTestTransport(async (_tag, input) => api.search(input));
});
test.afterEach(() => {
  test.cleanup();
  test.vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <cache.wrapper>{children}</cache.wrapper>;
}

test.stable(
  'debounces the latest query and keeps server search scoped to the selected subject',
  async () => {
    const view = test.renderHook(
      ({ query }) =>
        useSidebarSearch({ query, project, global: false, canSearch: true, content: 'workspace' }),
      { initialProps: { query: 'old' }, wrapper }
    );

    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(199);
    });
    test.expect(api.search).not.toHaveBeenCalled();
    view.rerender({ query: ' newest ' });
    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(199);
    });
    test.expect(api.search).not.toHaveBeenCalled();
    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(1);
    });
    test.expect(api.search).toHaveBeenCalledExactlyOnceWith({
      query: 'newest',
      project,
      limit: 30,
      kinds: ['note', 'message']
    });
  }
);

test.stable('cancels a pending debounce when its owner unmounts', async () => {
  const view = test.renderHook(
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
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(250);
  });
  test.expect(api.search).not.toHaveBeenCalled();
});

test.stable(
  'leaves document filtering local and removes subject restrictions from global search',
  async () => {
    const view = test.renderHook(
      ({ content }) =>
        useSidebarSearch({ query: 'notes', project, global: true, canSearch: true, content }),
      { initialProps: { content: 'pages' as 'pages' | 'workspace' }, wrapper }
    );

    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(250);
    });
    test.expect(api.search).not.toHaveBeenCalled();
    view.rerender({ content: 'workspace' });
    test.expect(api.search).toHaveBeenCalledExactlyOnceWith({
      query: 'notes',
      project: undefined,
      limit: 30
    });
  }
);
