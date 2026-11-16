import { noteSchema, defaultWorkspacePreferences } from '@study/contracts';
import { test } from '@study/testing';
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider
} from '@tanstack/react-router';
import { Schema } from 'effect';

import type * as __StudyMockType0 from '#client/app/shell/rich-sidebar.tsx';

function createApi(mock: test.Mock) {
  return {
    settings: mock.fn(),
    summaries: mock.fn(),
    settle: mock.fn()
  };
}

let api: ReturnType<typeof createApi>;

let RichSidebarNotes: typeof __StudyMockType0.RichSidebarNotes;

test.unit.beforeEach(async ({ mock }) => {
  api = createApi(mock);
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english', date: String })
  }));
  const __studyMockModule0 = await import('./rich-sidebar');

  RichSidebarNotes = __studyMockModule0.RichSidebarNotes;
});

let preferences = defaultWorkspacePreferences;

function fixture({ rpcTestTransport }: Pick<test.unit.Context, 'rpcTestTransport'>) {
  return rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.sidebarSettings') return api.settings(input);

    if (tag === 'notes.noteSummaries') return api.summaries(input);

    if (tag === 'notes.setNoteSettled') return api.settle(input);

    if (tag === 'settings.workspacePreferences') return preferences;

    throw new Error(tag);
  });
}

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

test.unit.afterEach(({ cleanup }) => {
  cleanup();
  preferences = defaultWorkspacePreferences;
});

test.unit.stable(
  'settles only notes meeting the saved document threshold and keeps running work open',
  async ({ render, screen, expect, within, fireEvent, act, waitFor, rpcTestTransport }) => {
    api.settings.mockResolvedValue({ settledPageThreshold: 2 });
    api.summaries.mockResolvedValue({
      items: [
        { id: 1n, generatedPageCount: 1n, running: false, activity: 'idle' },
        { id: 2n, generatedPageCount: 2n, running: false, activity: 'idle' },
        { id: 3n, generatedPageCount: 5n, running: true, activity: 'generating' }
      ]
    });
    const cache = fixture({ rpcTestTransport });

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
      <cache.wrapper>
        <RouterProvider router={router} />
      </cache.wrapper>
    );

    await screen.findByText('SidebarGenerating');
    const generatingRow = screen
      .getByRole('link', { name: /\bNote 3\b/ })
      .closest('.study-note-entry') as HTMLElement;
    const idleRow = screen
      .getByRole('link', { name: /\bNote 1\b/ })
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
    expect(
      within(groups[0] as HTMLElement).getByRole('link', { name: /\bNote 1\b/ })
    ).toBeVisible();
    expect(
      within(groups[0] as HTMLElement).getByRole('link', { name: /\bNote 3\b/ })
    ).toBeVisible();
    expect(within(groups[0] as HTMLElement).queryByRole('link', { name: /\bNote 2\b/ })).toBeNull();
    expect(groups[1]).not.toHaveAttribute('open');
    fireEvent.click(within(groups[1] as HTMLElement).getByText('SidebarSettled'));
    expect(
      await within(groups[1] as HTMLElement).findByRole('link', { name: /\bNote 2\b/ })
    ).toBeInTheDocument();
    expect(api.summaries).toHaveBeenCalledTimes(1);
    await act(async () => {
      preferences = {
        ...defaultWorkspacePreferences,
        sidebarDensity: 'compact'
      };
      await cache.notify();
    });
    const compact = screen.getByRole('link', { name: /\bNote 1\b/ });

    await waitFor(() => expect(compact).toHaveAttribute('data-layout', 'compact'));
    expect(within(compact).getByTitle('SidebarGeneratedPages')).toHaveTextContent('1');
    expect(within(compact).getByText('SidebarReady')).toBeInTheDocument();
    expect(within(idleRow).getByRole('button', { name: 'SidebarTurnIntoPage' }).parentElement).toBe(
      within(idleRow).getByRole('button', { name: 'SidebarSettle' }).parentElement
    );
    expect(within(generatingRow).queryByRole('button', { name: 'SidebarTurnIntoPage' })).toBeNull();
    expect(
      within(screen.getByRole('link', { name: /\bNote 3\b/ })).getByText('SidebarGenerating')
    ).toBeInTheDocument();
    await act(async () => {
      preferences = {
        ...defaultWorkspacePreferences,
        sidebarDensity: 'compact',
        sidebarShowPageCounts: false
      };
      await cache.notify();
    });
    await waitFor(() =>
      expect(within(compact).queryByTitle('SidebarGeneratedPages')).not.toBeInTheDocument()
    );
  }
);

test.unit.stable(
  'settles a row without navigating and persists an explicit reopen over the automatic threshold',
  async ({ render, screen, fireEvent, waitFor, expect, within, rpcTestTransport }) => {
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
    const cache = fixture({ rpcTestTransport });

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
      <cache.wrapper>
        <RouterProvider router={router} />
      </cache.wrapper>
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

test.unit.stable(
  'shows settled notes as compact recent rows with ten initially and twenty-five more per click',
  async ({ render, screen, expect, fireEvent, waitFor, within, rpcTestTransport }) => {
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
    const cache = fixture({ rpcTestTransport });

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
      <cache.wrapper>
        <RouterProvider router={router} />
      </cache.wrapper>
    );

    const summary = await screen.findByText('SidebarSettled');
    const group = summary.closest('details')!;

    expect(group).not.toHaveAttribute('open');
    fireEvent.click(summary);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /\bSettled 1\b/ })).toHaveAttribute(
        'data-layout',
        'summary'
      )
    );
    const first = screen.getByRole('link', { name: /\bSettled 1\b/ });

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

function mountSelectionSidebar({
  render,
  rpcTestTransport
}: Pick<test.unit.Context, 'render' | 'rpcTestTransport'>) {
  api.settings.mockResolvedValue({ settledPageThreshold: 1 });
  api.summaries.mockResolvedValue({
    items: notes.map((note) => ({
      id: note.id,
      generatedPageCount: 0n,
      running: false,
      activity: 'idle'
    }))
  });
  const cache = fixture({ rpcTestTransport });

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
    <cache.wrapper>
      <RouterProvider router={router} />
    </cache.wrapper>
  );

  return router;
}

test.unit.stable(
  'starts selection from a row context menu and creates one document from the selected rows without navigating',
  async ({ fireEvent, screen, expect, within, render, rpcTestTransport }) => {
    const router = mountSelectionSidebar({ render, rpcTestTransport });

    fireEvent.contextMenu(await screen.findByRole('link', { name: /\bNote 1\b/ }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    expect(await screen.findByRole('button', { name: /\bNote 1\b/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: /\bNote 2\b/ }));
    expect(screen.getByRole('button', { name: /\bNote 2\b/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const row = screen.getByRole('button', { name: /\bNote 1\b/ });

    expect(row).toHaveAttribute('data-layout', 'detailed');
    expect(await within(row).findByText('SidebarReady')).toBeVisible();
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

test.unit.stable(
  'disables batch actions for zero selected rows and cancel returns to navigation',
  async ({ fireEvent, screen, expect, within, render, rpcTestTransport }) => {
    mountSelectionSidebar({ render, rpcTestTransport });
    fireEvent.contextMenu(await screen.findByRole('link', { name: /\bNote 1\b/ }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    fireEvent.click(await screen.findByRole('button', { name: /\bNote 1\b/ }));
    const toolbar = screen.getByRole('toolbar', { name: 'SidebarSelectionActions' });

    expect(toolbar).toHaveFocus();
    expect(within(toolbar).getByRole('button', { name: 'NoteCreatePage' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'SidebarDeleteSelected' })).toBeDisabled();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('link', { name: /\bNote 1\b/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /\bNote 1\b/ })).toHaveFocus();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('toolbar', { name: 'SidebarSelectionActions' })
    ).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'opens deletion review for the selected notes without deleting on selection',
  async ({ fireEvent, screen, within, expect, render, rpcTestTransport }) => {
    mountSelectionSidebar({ render, rpcTestTransport });
    fireEvent.contextMenu(await screen.findByRole('link', { name: /\bNote 1\b/ }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    fireEvent.click(await screen.findByRole('button', { name: /\bNote 3\b/ }));
    fireEvent.click(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'SidebarDeleteSelected' })
    );
    const dialog = await screen.findByRole('alertdialog');

    expect(within(dialog).getByText('Note 1')).toBeVisible();
    expect(within(dialog).getByText('Note 3')).toBeVisible();
    expect(within(dialog).queryByText('Note 2')).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'keeps loaded settled rows available regardless of the sidebar height',
  async ({ vi, render, fireEvent, screen, waitFor, expect, within, rpcTestTransport }) => {
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
    const cache = fixture({ rpcTestTransport });

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
        <cache.wrapper>
          <RouterProvider router={router} />
        </cache.wrapper>
      );
      fireEvent.click(await screen.findByText('SidebarSettled'));
      await waitFor(() =>
        expect(screen.getByRole('link', { name: /\bRecent 1\b/ })).toHaveAttribute(
          'data-layout',
          'summary'
        )
      );
      const group = screen.getByRole('link', { name: /\bRecent 1\b/ }).closest('details')!;

      expect(within(group).getAllByRole('link')).toHaveLength(7);
      expect(
        within(group).queryByRole('button', { name: 'SidebarShowMore' })
      ).not.toBeInTheDocument();
    } finally {
      geometry.mockRestore();
      vi.unstubAllGlobals();
    }
  }
);

test.unit.stable(
  'uses keyboard row toggles without changing the sidebar density or navigating',
  async ({ screen, expect, fireEvent, userEvent, within, render, rpcTestTransport }) => {
    const router = mountSelectionSidebar({ render, rpcTestTransport });
    const original = await screen.findByRole('link', { name: /\bNote 1\b/ });

    expect(original).toHaveAttribute('data-layout', 'detailed');
    fireEvent.contextMenu(original, { button: 2, clientX: 80, clientY: 80 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    const row = await screen.findByRole('button', { name: /\bNote 2\b/ });

    expect(row).toHaveAttribute('data-layout', 'detailed');
    expect(row).toHaveAttribute('aria-pressed', 'false');
    row.focus();
    await userEvent.setup().keyboard(' ');
    expect(row).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().keyboard('{Enter}');
    expect(row).toHaveAttribute('aria-pressed', 'false');
    expect(await within(row).findByText('SidebarReady')).toBeVisible();
    expect(router.state.location.pathname).toBe('/');
  }
);

test.unit.stable(
  'opens the conversion dialog from a row without navigating or settling it',
  async ({ screen, expect, within, fireEvent, render, rpcTestTransport }) => {
    const router = mountSelectionSidebar({ render, rpcTestTransport });
    const link = await screen.findByRole('link', { name: /\bNote 1\b/ });
    const row = link.closest('.study-note-entry') as HTMLElement;

    expect(within(row).getByRole('button', { name: 'SidebarSettle' })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'SidebarTurnIntoPage' }));
    const dialog = await screen.findByRole('dialog', { name: 'NoteTransform' });

    expect(within(dialog).getByText('Note 1')).toBeVisible();
    expect(within(dialog).queryByText('Note 2')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  }
);

test.unit.stable(
  'offers merge only after selecting at least two notes',
  async ({ render, fireEvent, screen, expect, within, rpcTestTransport }) => {
    api.settings.mockResolvedValue({ settledPageThreshold: 1 });
    api.summaries.mockResolvedValue({ items: [] });
    const cache = fixture({ rpcTestTransport });

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
      <cache.wrapper>
        <RouterProvider router={router} />
      </cache.wrapper>
    );
    fireEvent.contextMenu(await screen.findByRole('link', { name: /\bNote 1\b/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    expect(screen.getByRole('button', { name: 'NoteMerge' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /\bNote 2\b/ }));
    expect(screen.getByRole('button', { name: 'NoteMerge' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteMerge' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText('NoteMergeHelp')).toBeInTheDocument();
    expect(within(dialog).getByText('Note 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Note 2')).toBeInTheDocument();
  }
);
