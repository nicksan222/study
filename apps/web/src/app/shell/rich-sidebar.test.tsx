import { sessionSchema } from '@study/contracts/conversations/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { RichSidebarSessions } from './rich-sidebar';

const api = vi.hoisted(() => ({ settings: vi.fn(), summaries: vi.fn(), settle: vi.fn() }));

vi.mock('../../lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english', date: String })
}));
vi.mock('../../lib/study-client/request', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'settings.sidebarSettings': api.settings,
      'conversations.sessionSummaries': api.summaries,
      'conversations.setSessionSettled': api.settle
    })
}));

const sessions = [1n, 2n, 3n].map((id) =>
  Schema.decodeUnknownSync(sessionSchema)({
    id,
    title: 'Session ' + id,
    titleSource: 'user',
    projectIds: [],
    createdAt: 1n,
    updatedAt: 2n
  })
);

const caches: QueryClient[] = [];

afterEach(() => {
  cleanup();
  caches.splice(0).forEach((cache) => cache.clear());
});

it('settles only sessions meeting the saved document threshold and keeps running work open', async () => {
  api.settings.mockResolvedValue({ settledDocumentThreshold: 2 });
  api.summaries.mockResolvedValue({
    items: [
      { id: 1n, generatedDocumentCount: 1n, running: false, activity: 'idle' },
      { id: 2n, generatedDocumentCount: 2n, running: false, activity: 'idle' },
      { id: 3n, generatedDocumentCount: 5n, running: true, activity: 'generating' }
    ]
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  caches.push(cache);
  const route = createRootRoute({
    component: () => (
      <RichSidebarSessions
        sessions={sessions}
        subjects={[]}
        project={undefined}
        selectedSession="1"
      />
    )
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] })
  });
  const view = render(
    <QueryClientProvider client={cache}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  await screen.findByText('SidebarGenerating');
  const groups = view.container.querySelectorAll('details');

  expect(groups[0]).toHaveAttribute('open');
  expect(within(groups[0] as HTMLElement).getByRole('link', { name: 'Session 1' })).toBeVisible();
  expect(within(groups[0] as HTMLElement).getByRole('link', { name: 'Session 3' })).toBeVisible();
  expect(within(groups[0] as HTMLElement).queryByRole('link', { name: 'Session 2' })).toBeNull();
  expect(groups[1]).not.toHaveAttribute('open');
  fireEvent.click(within(groups[1] as HTMLElement).getByText('SidebarSettled'));
  expect(
    within(groups[1] as HTMLElement).getByRole('link', { name: 'Session 2' })
  ).toBeInTheDocument();
  expect(api.summaries).toHaveBeenCalledTimes(1);
});

it('settles a row without navigating and persists an explicit reopen over the automatic threshold', async () => {
  let override: boolean | null = null;

  api.settings.mockResolvedValue({ settledDocumentThreshold: 2 });
  api.summaries.mockImplementation(() =>
    Promise.resolve({
      items: [
        {
          id: 1n,
          generatedDocumentCount: override === false ? 5n : 0n,
          running: false,
          activity: 'idle',
          settledOverride: override
        }
      ]
    })
  );
  api.settle.mockImplementation(({ settled }: { settled: boolean }) => {
    override = settled;

    return Promise.resolve({});
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  caches.push(cache);
  const route = createRootRoute({
    component: () => (
      <RichSidebarSessions
        sessions={sessions.slice(0, 1)}
        subjects={[]}
        project={undefined}
        selectedSession="1"
      />
    )
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] })
  });
  const view = render(
    <QueryClientProvider client={cache}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  const settle = await screen.findByRole('button', { name: 'SidebarSettle' });

  fireEvent.click(settle);
  await waitFor(() => expect(api.settle).toHaveBeenCalledWith({ id: 1n, settled: true }));
  await waitFor(() =>
    expect(
      view.container.querySelector('.study-session-group:last-child .study-session-title')
    ).toHaveTextContent('Session 1')
  );
  const group = view.container.querySelector('.study-session-group:last-child') as HTMLElement;

  fireEvent.click(within(group).getByText('SidebarSettled'));
  fireEvent.click(within(group).getByRole('button', { name: 'SidebarReopen' }));
  await waitFor(() => expect(api.settle).toHaveBeenLastCalledWith({ id: 1n, settled: false }));
  await waitFor(() =>
    expect(
      view.container.querySelector('.study-session-group:first-child .study-session-title')
    ).toHaveTextContent('Session 1')
  );
  expect(router.state.location.pathname).toBe('/');
});
