import { noteSchema } from '@study/contracts/notes/schemas';
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

import { RichSidebarNotes } from './rich-sidebar';

const api = vi.hoisted(() => ({ settings: vi.fn(), summaries: vi.fn(), settle: vi.fn() }));

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english', date: String })
}));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'settings.sidebarSettings': api.settings,
      'notes.noteSummaries': api.summaries,
      'notes.setNoteSettled': api.settle,
      'settings.workspacePreferences': async () => defaultWorkspacePreferences
    })
}));

const notes = [1n, 2n, 3n].map((id) =>
  Schema.decodeUnknownSync(noteSchema)({
    id,
    title: 'Note ' + id,
    titleSource: 'user',
    archivedAt: null,
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
  'settles only notes meeting the saved document threshold and keeps running work open',
  async () => {
    api.settings.mockResolvedValue({ settledPageThreshold: 2 });
    api.summaries.mockResolvedValue({
      items: [
        { id: 1n, generatedPageCount: 1n, running: false, activity: 'idle' },
        { id: 2n, generatedPageCount: 2n, running: false, activity: 'idle' },
        { id: 3n, generatedPageCount: 5n, running: true, activity: 'generating' }
      ]
    });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    caches.push(cache);
    const route = createRootRoute({
      component: () => (
        <RichSidebarNotes notes={notes} subjects={[]} project={undefined} selectedNote="1" />
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
    const generatingRow = screen
      .getByRole('link', { name: 'Note 3' })
      .closest('.study-note-entry') as HTMLElement;
    const idleRow = screen
      .getByRole('link', { name: 'Note 1' })
      .closest('.study-note-entry') as HTMLElement;

    expect(within(generatingRow).queryByRole('button', { name: 'SidebarTurnIntoPage' })).toBeNull();
    const generatingSettle = within(generatingRow).getByRole('button', { name: 'SidebarSettle' });

    expect(generatingSettle).toBeDisabled();
    expect(generatingSettle.parentElement).toHaveAttribute('data-placement', 'top');
    expect(
      within(idleRow).getByRole('button', { name: 'SidebarTurnIntoPage' }).parentElement
    ).toHaveAttribute('data-placement', 'bottom');
    expect(
      within(idleRow).getByRole('button', { name: 'SidebarSettle' }).parentElement
    ).toHaveAttribute('data-placement', 'top');
    const groups = view.container.querySelectorAll('details');

    expect(groups[0]).toHaveAttribute('open');
    expect(within(groups[0] as HTMLElement).getByRole('link', { name: 'Note 1' })).toBeVisible();
    expect(within(groups[0] as HTMLElement).getByRole('link', { name: 'Note 3' })).toBeVisible();
    expect(within(groups[0] as HTMLElement).queryByRole('link', { name: 'Note 2' })).toBeNull();
    expect(groups[1]).not.toHaveAttribute('open');
    fireEvent.click(within(groups[1] as HTMLElement).getByText('SidebarSettled'));
    expect(
      await within(groups[1] as HTMLElement).findByRole('link', { name: 'Note 2' })
    ).toBeInTheDocument();
    expect(api.summaries).toHaveBeenCalledTimes(1);
    await act(async () => {
      cache.setQueryData(['workspace-preferences'], {
        ...defaultWorkspacePreferences,
        sidebarDensity: 'compact'
      });
    });
    const compact = screen.getByRole('link', { name: 'Note 1' });

    await waitFor(() => expect(compact).toHaveAttribute('data-layout', 'compact'));
    expect(within(compact).getByTitle('SidebarGeneratedPages')).toHaveTextContent('1');
    expect(within(compact).getByText('SidebarReady')).toBeInTheDocument();
    expect(within(idleRow).getByRole('button', { name: 'SidebarTurnIntoPage' }).parentElement).toBe(
      within(idleRow).getByRole('button', { name: 'SidebarSettle' }).parentElement
    );
    expect(within(generatingRow).queryByRole('button', { name: 'SidebarTurnIntoPage' })).toBeNull();
    expect(
      within(screen.getByRole('link', { name: 'Note 3' })).getByText('SidebarGenerating')
    ).toBeInTheDocument();
    await act(async () => {
      cache.setQueryData(['workspace-preferences'], {
        ...defaultWorkspacePreferences,
        sidebarDensity: 'compact',
        sidebarShowPageCounts: false
      });
    });
    await waitFor(() =>
      expect(within(compact).queryByTitle('SidebarGeneratedPages')).not.toBeInTheDocument()
    );
  }
);

testStable(
  'settles a row without navigating and persists an explicit reopen over the automatic threshold',
  async () => {
    let override: boolean | null = null;

    api.settings.mockResolvedValue({ settledPageThreshold: 2 });
    api.summaries.mockImplementation(() =>
      Promise.resolve({
        items: [
          {
            id: 1n,
            generatedPageCount: override === false ? 5n : 0n,
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
        <RichSidebarNotes
          notes={notes.slice(0, 1)}
          subjects={[]}
          project={undefined}
          selectedNote="1"
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
        view.container.querySelector('.study-note-group:last-child .study-note-title')
      ).toHaveTextContent('Note 1')
    );
    const group = view.container.querySelector('.study-note-group:last-child') as HTMLElement;

    fireEvent.click(within(group).getByText('SidebarSettled'));
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: 'SidebarReopen' })).toBeVisible()
    );
    expect(
      within(group).queryByRole('button', { name: 'SidebarTurnIntoPage' })
    ).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'SidebarReopen' }));
    await waitFor(() => expect(api.settle).toHaveBeenLastCalledWith({ id: 1n, settled: false }));
    await waitFor(() =>
      expect(
        view.container.querySelector('.study-note-group:first-child .study-note-title')
      ).toHaveTextContent('Note 1')
    );
    expect(router.state.location.pathname).toBe('/');
  }
);

testStable(
  'shows settled notes as compact recent rows with ten initially and twenty-five more per click',
  async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      ...notes[0]!,
      id: BigInt(index + 1) as (typeof notes)[number]['id'],
      title: 'Settled ' + (index + 1),
      updatedAt: BigInt(1000 - index)
    }));

    api.settings.mockResolvedValue({ settledPageThreshold: 1 });
    api.summaries.mockResolvedValue({
      items: many.map((note) => ({
        id: note.id,
        generatedPageCount: 1n,
        running: false,
        activity: 'idle',
        settledOverride: true
      }))
    });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    caches.push(cache);
    const route = createRootRoute({
      component: () => (
        <RichSidebarNotes notes={many} subjects={[]} project={undefined} selectedNote={null} />
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
  api.settings.mockResolvedValue({ settledPageThreshold: 1 });
  api.summaries.mockResolvedValue({
    items: notes.map((note) => ({
      id: note.id,
      generatedPageCount: 0n,
      running: false,
      activity: 'idle'
    }))
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  caches.push(cache);
  const route = createRootRoute({
    component: () => (
      <RichSidebarNotes notes={notes} subjects={[]} project={undefined} selectedNote={null} />
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

    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Note 1' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    expect(await screen.findByRole('button', { name: 'Note 1' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Note 2' }));
    expect(screen.getByRole('button', { name: 'Note 2' })).toHaveAttribute('aria-pressed', 'true');
    const row = screen.getByRole('button', { name: 'Note 1' });

    expect(row).toHaveAttribute('data-layout', 'detailed');
    expect(within(row).getByText('SidebarReady')).toBeVisible();
    expect(within(row).getByTitle('SidebarGeneratedPages')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    const toolbar = screen.getByRole('toolbar', { name: 'SidebarSelectionActions' });

    expect(toolbar.parentElement).toBe(document.body);
    fireEvent.click(within(toolbar).getByRole('button', { name: 'NoteCreatePage' }));
    const dialog = await screen.findByRole('dialog', { name: 'NoteTransform' });

    expect(within(dialog).getByText('Note 1')).toBeVisible();
    expect(within(dialog).getByText('Note 2')).toBeVisible();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('searchbox')).not.toBeInTheDocument();
  }
);

testStable(
  'disables batch actions for zero selected rows and cancel returns to navigation',
  async () => {
    mountSelectionSidebar();
    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Note 1' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Note 1' }));
    const toolbar = screen.getByRole('toolbar', { name: 'SidebarSelectionActions' });

    expect(toolbar).toHaveFocus();
    expect(within(toolbar).getByRole('button', { name: 'NoteCreatePage' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'SidebarDeleteSelected' })).toBeDisabled();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('link', { name: 'Note 1' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Note 1' })).toHaveFocus();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('toolbar', { name: 'SidebarSelectionActions' })
    ).not.toBeInTheDocument();
  }
);

testStable(
  'opens deletion review for the selected notes without deleting on selection',
  async () => {
    mountSelectionSidebar();
    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Note 1' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Note 3' }));
    fireEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'SidebarDeleteSelected' })
    );
    const dialog = await screen.findByRole('alertdialog');

    expect(within(dialog).getByText('Note 1')).toBeVisible();
    expect(within(dialog).getByText('Note 3')).toBeVisible();
    expect(within(dialog).queryByText('Note 2')).not.toBeInTheDocument();
  }
);

testStable('keeps loaded settled rows available regardless of the sidebar height', async () => {
  const many = Array.from({ length: 7 }, (_, index) => ({
    ...notes[0]!,
    id: BigInt(index + 1) as (typeof notes)[number]['id'],
    title: 'Recent ' + (index + 1)
  }));

  api.settings.mockResolvedValue({ settledPageThreshold: 1 });
  api.summaries.mockResolvedValue({
    items: many.map((note) => ({
      id: note.id,
      generatedPageCount: 1n,
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
          : this.classList.contains('study-note-entry')
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
          <RichSidebarNotes notes={many} subjects={[]} project={undefined} selectedNote={null} />
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

    expect(within(group).getAllByRole('link')).toHaveLength(7);
    expect(
      within(group).queryByRole('button', { name: 'SidebarShowMore' })
    ).not.toBeInTheDocument();
  } finally {
    geometry.mockRestore();
    vi.unstubAllGlobals();
  }
});

testStable(
  'uses keyboard row toggles without changing the sidebar density or navigating',
  async () => {
    const router = mountSelectionSidebar();
    const original = await screen.findByRole('link', { name: 'Note 1' });

    expect(original).toHaveAttribute('data-layout', 'detailed');
    fireEvent.contextMenu(original, { button: 2, clientX: 80, clientY: 80 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    const row = await screen.findByRole('button', { name: 'Note 2' });

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
  const link = await screen.findByRole('link', { name: 'Note 1' });
  const row = link.closest('.study-note-entry') as HTMLElement;

  expect(within(row).getByRole('button', { name: 'SidebarSettle' })).toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'SidebarTurnIntoPage' }));
  const dialog = await screen.findByRole('dialog', { name: 'NoteTransform' });

  expect(within(dialog).getByText('Note 1')).toBeVisible();
  expect(within(dialog).queryByText('Note 2')).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
});

testStable('offers merge only after selecting at least two notes', async () => {
  api.settings.mockResolvedValue({ settledPageThreshold: 1 });
  api.summaries.mockResolvedValue({ items: [] });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  caches.push(cache);
  const route = createRootRoute({
    component: () => (
      <RichSidebarNotes notes={notes} subjects={[]} project={undefined} selectedNote={null} />
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
  fireEvent.contextMenu(await screen.findByRole('link', { name: 'Note 1' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
  expect(screen.getByRole('button', { name: 'NoteMerge' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Note 2' }));
  expect(screen.getByRole('button', { name: 'NoteMerge' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'NoteMerge' }));
  const dialog = await screen.findByRole('dialog');

  expect(within(dialog).getByText('NoteMergeHelp')).toBeInTheDocument();
  expect(within(dialog).getByText('Note 1')).toBeInTheDocument();
  expect(within(dialog).getByText('Note 2')).toBeInTheDocument();
});
