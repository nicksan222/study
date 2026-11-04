import { sessionSchema } from '@study/contracts/conversations/schemas';
import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { RichSidebarSessions } from './rich-sidebar';

const api = vi.hoisted(() => ({ settings: vi.fn(), summaries: vi.fn(), settle: vi.fn() }));

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english', date: String })
}));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'settings.sidebarSettings': api.settings,
      'conversations.sessionSummaries': api.summaries,
      'conversations.setSessionSettled': api.settle,
      'settings.workspacePreferences': async () => defaultWorkspacePreferences
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

testStable(
  'settles only sessions meeting the saved document threshold and keeps running work open',
  async () => {
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
      await within(groups[1] as HTMLElement).findByRole('link', { name: 'Session 2' })
    ).toBeInTheDocument();
    expect(api.summaries).toHaveBeenCalledTimes(1);
    await act(async () => {
      cache.setQueryData(['workspace-preferences'], {
        ...defaultWorkspacePreferences,
        sidebarDensity: 'compact'
      });
    });
    const compact = screen.getByRole('link', { name: 'Session 1' });

    await waitFor(() => expect(compact).toHaveAttribute('data-layout', 'compact'));
    expect(within(compact).getByTitle('SidebarGeneratedDocuments')).toHaveTextContent('1');
    expect(within(compact).getByText('SidebarReady')).toBeInTheDocument();
    expect(
      within(screen.getByRole('link', { name: 'Session 3' })).getByText('SidebarGenerating')
    ).toBeInTheDocument();
    await act(async () => {
      cache.setQueryData(['workspace-preferences'], {
        ...defaultWorkspacePreferences,
        sidebarDensity: 'compact',
        sidebarShowDocumentCounts: false
      });
    });
    await waitFor(() =>
      expect(within(compact).queryByTitle('SidebarGeneratedDocuments')).not.toBeInTheDocument()
    );
  }
);

testStable(
  'settles a row without navigating and persists an explicit reopen over the automatic threshold',
  async () => {
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
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: 'SidebarReopen' })).toBeVisible()
    );
    fireEvent.click(within(group).getByRole('button', { name: 'SidebarReopen' }));
    await waitFor(() => expect(api.settle).toHaveBeenLastCalledWith({ id: 1n, settled: false }));
    await waitFor(() =>
      expect(
        view.container.querySelector('.study-session-group:first-child .study-session-title')
      ).toHaveTextContent('Session 1')
    );
    expect(router.state.location.pathname).toBe('/');
  }
);

testStable(
  'shows settled sessions as compact recent rows with ten initially and twenty-five more per click',
  async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      ...sessions[0]!,
      id: BigInt(index + 1) as (typeof sessions)[number]['id'],
      title: 'Settled ' + (index + 1),
      updatedAt: BigInt(1000 - index)
    }));

    api.settings.mockResolvedValue({ settledDocumentThreshold: 1 });
    api.summaries.mockResolvedValue({
      items: many.map((session) => ({
        id: session.id,
        generatedDocumentCount: 1n,
        running: false,
        activity: 'idle',
        settledOverride: true
      }))
    });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    caches.push(cache);
    const route = createRootRoute({
      component: () => (
        <RichSidebarSessions
          sessions={many}
          subjects={[]}
          project={undefined}
          selectedSession={null}
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

    const summary = await screen.findByText('SidebarSettled');
    const group = summary.closest('details')!;

    expect(group).not.toHaveAttribute('open');
    fireEvent.click(summary);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Settled 1' })).toHaveAttribute(
        'data-layout',
        'summary'
      )
    );
    const first = screen.getByRole('link', { name: 'Settled 1' });

    expect(group).toHaveAttribute('open');
    expect(group).toHaveAttribute('data-variant', 'settled');
    expect(within(group).getAllByRole('link')).toHaveLength(10);
    expect(first).toHaveAttribute('data-layout', 'summary');
    expect(first.querySelector('time')).toBeInTheDocument();
    expect(within(first).queryByText('SidebarReady')).not.toBeInTheDocument();
    expect(group.querySelector('summary')).toHaveTextContent('40');
    fireEvent.click(within(group).getByRole('button', { name: 'SidebarShowMore' }));
    expect(within(group).getAllByRole('link')).toHaveLength(35);
    fireEvent.click(within(group).getByRole('button', { name: 'SidebarShowMore' }));
    expect(within(group).getAllByRole('link')).toHaveLength(40);
    expect(
      within(group).queryByRole('button', { name: 'SidebarShowMore' })
    ).not.toBeInTheDocument();
    view.unmount();
  }
);

function mountSelectionSidebar() {
  api.settings.mockResolvedValue({ settledDocumentThreshold: 1 });
  api.summaries.mockResolvedValue({
    items: sessions.map((session) => ({
      id: session.id,
      generatedDocumentCount: 0n,
      running: false,
      activity: 'idle'
    }))
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  caches.push(cache);
  const route = createRootRoute({
    component: () => (
      <RichSidebarSessions
        sessions={sessions}
        subjects={[]}
        project={undefined}
        selectedSession={null}
      />
    )
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  render(
    <QueryClientProvider client={cache}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return router;
}

testStable(
  'starts selection from a row context menu and creates one document from the selected rows without navigating',
  async () => {
    const router = mountSelectionSidebar();

    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Session 1' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectSessions' }));
    expect(await screen.findByRole('button', { name: 'Session 1' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Session 2' }));
    expect(screen.getByRole('button', { name: 'Session 2' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const row = screen.getByRole('button', { name: 'Session 1' });

    expect(row).toHaveAttribute('data-layout', 'detailed');
    expect(within(row).getByText('SidebarReady')).toBeVisible();
    expect(within(row).getByTitle('SidebarGeneratedDocuments')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    const toolbar = screen.getByRole('toolbar', { name: 'SidebarSelectionActions' });

    expect(toolbar.parentElement).toBe(document.body);
    fireEvent.click(within(toolbar).getByRole('button', { name: 'SessionCreateDocument' }));
    const dialog = await screen.findByRole('dialog', { name: 'SessionTransform' });

    expect(within(dialog).getByText('Session 1')).toBeVisible();
    expect(within(dialog).getByText('Session 2')).toBeVisible();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('searchbox')).not.toBeInTheDocument();
  }
);

testStable(
  'disables batch actions for zero selected rows and cancel returns to navigation',
  async () => {
    mountSelectionSidebar();
    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Session 1' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectSessions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Session 1' }));
    const toolbar = screen.getByRole('toolbar', { name: 'SidebarSelectionActions' });

    expect(toolbar).toHaveFocus();
    expect(within(toolbar).getByRole('button', { name: 'SessionCreateDocument' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'SidebarDeleteSelected' })).toBeDisabled();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('link', { name: 'Session 1' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Session 1' })).toHaveFocus();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('toolbar', { name: 'SidebarSelectionActions' })
    ).not.toBeInTheDocument();
  }
);

testStable(
  'opens deletion review for the selected sessions without deleting on selection',
  async () => {
    mountSelectionSidebar();
    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Session 1' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectSessions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Session 3' }));
    fireEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'SidebarDeleteSelected' })
    );
    const dialog = await screen.findByRole('alertdialog');

    expect(within(dialog).getByText('Session 1')).toBeVisible();
    expect(within(dialog).getByText('Session 3')).toBeVisible();
    expect(within(dialog).queryByText('Session 2')).not.toBeInTheDocument();
  }
);

testStable('offers more when seven settled rows exceed the bottom-half preview', async () => {
  const many = Array.from({ length: 7 }, (_, index) => ({
    ...sessions[0]!,
    id: BigInt(index + 1) as (typeof sessions)[number]['id'],
    title: 'Recent ' + (index + 1)
  }));

  api.settings.mockResolvedValue({ settledDocumentThreshold: 1 });
  api.summaries.mockResolvedValue({
    items: many.map((session) => ({
      id: session.id,
      generatedDocumentCount: 1n,
      running: false,
      activity: 'idle'
    }))
  });
  const geometry = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const height = this.classList.contains('study-sidebar-scroll')
        ? 400
        : this.tagName === 'SUMMARY'
          ? 38
          : this.classList.contains('study-session-entry')
            ? 36
            : 0;

      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 280,
        bottom: height,
        width: 280,
        height,
        toJSON: () => ({})
      };
    });

  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}
    }
  );
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  caches.push(cache);

  try {
    const route = createRootRoute({
      component: () => (
        <div className="study-sidebar-scroll">
          <RichSidebarSessions
            sessions={many}
            subjects={[]}
            project={undefined}
            selectedSession={null}
          />
        </div>
      )
    });
    const router = createRouter({
      routeTree: route,
      history: createMemoryHistory({ initialEntries: ['/'] })
    });

    render(
      <QueryClientProvider client={cache}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    fireEvent.click(await screen.findByText('SidebarSettled'));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Recent 1' })).toHaveAttribute(
        'data-layout',
        'summary'
      )
    );
    const group = screen.getByRole('link', { name: 'Recent 1' }).closest('details')!;

    await waitFor(() => expect(within(group).getAllByRole('link')).toHaveLength(3));
    fireEvent.click(within(group).getByRole('button', { name: 'SidebarShowMore' }));
    expect(within(group).getAllByRole('link')).toHaveLength(7);
  } finally {
    geometry.mockRestore();
    vi.unstubAllGlobals();
  }
});

testStable(
  'uses keyboard row toggles without changing the sidebar density or navigating',
  async () => {
    const router = mountSelectionSidebar();
    const original = await screen.findByRole('link', { name: 'Session 1' });

    expect(original).toHaveAttribute('data-layout', 'detailed');
    fireEvent.contextMenu(original, { button: 2, clientX: 80, clientY: 80 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectSessions' }));
    const row = await screen.findByRole('button', { name: 'Session 2' });

    expect(row).toHaveAttribute('data-layout', 'detailed');
    expect(row).toHaveAttribute('aria-pressed', 'false');
    row.focus();
    await userEvent.setup().keyboard(' ');
    expect(row).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().keyboard('{Enter}');
    expect(row).toHaveAttribute('aria-pressed', 'false');
    expect(within(row).getByText('SidebarReady')).toBeVisible();
    expect(router.state.location.pathname).toBe('/');
  }
);

testStable('opens the conversion dialog from a row without navigating or settling it', async () => {
  const router = mountSelectionSidebar();
  const link = await screen.findByRole('link', { name: 'Session 1' });
  const row = link.closest('.study-session-entry') as HTMLElement;

  expect(within(row).getByRole('button', { name: 'SidebarSettle' })).toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'SidebarTurnIntoDoc' }));
  const dialog = await screen.findByRole('dialog', { name: 'SessionTransform' });

  expect(within(dialog).getByText('Session 1')).toBeVisible();
  expect(within(dialog).queryByText('Session 2')).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
});
