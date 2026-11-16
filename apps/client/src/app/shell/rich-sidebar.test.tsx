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

test.beforeEach(async ({ mock }) => {
  api = createApi(mock);
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english', date: String })
  }));
  const __studyMockModule0 = await import('./rich-sidebar');

  RichSidebarNotes = __studyMockModule0.RichSidebarNotes;
});

let preferences = defaultWorkspacePreferences;

function fixture() {
  return test.rpcTestTransport(async (tag, input) => {
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

test.afterEach(() => {
  test.cleanup();
  preferences = defaultWorkspacePreferences;
});

test.stable(
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
    const cache = fixture();

    const route = createRootRoute({
      component: () => (
        <RichSidebarNotes notes={notes} subjects={[]} project={undefined} selectedNote="1" />
      )
    });
    const router = createRouter({
      routeTree: route,
      history: createMemoryHistory({ initialEntries: ['/'] })
    });
    const view = test.render(
      <cache.wrapper>
        <RouterProvider router={router} />
      </cache.wrapper>
    );

    await test.screen.findByText('SidebarGenerating');
    const generatingRow = test.screen
      .getByRole('link', { name: /\bNote 3\b/ })
      .closest('.study-note-entry') as HTMLElement;
    const idleRow = test.screen
      .getByRole('link', { name: /\bNote 1\b/ })
      .closest('.study-note-entry') as HTMLElement;

    test
      .expect(test.within(generatingRow).queryByRole('button', { name: 'SidebarTurnIntoPage' }))
      .toBeNull();
    const generatingSettle = test
      .within(generatingRow)
      .getByRole('button', { name: 'SidebarSettle' });

    test.expect(generatingSettle).toBeDisabled();
    test.expect(generatingSettle.parentElement).toHaveAttribute('data-placement', 'top');
    test
      .expect(
        test.within(idleRow).getByRole('button', { name: 'SidebarTurnIntoPage' }).parentElement
      )
      .toHaveAttribute('data-placement', 'bottom');
    test
      .expect(test.within(idleRow).getByRole('button', { name: 'SidebarSettle' }).parentElement)
      .toHaveAttribute('data-placement', 'top');
    const groups = view.container.querySelectorAll('details');

    test.expect(groups[0]).toHaveAttribute('open');
    test
      .expect(test.within(groups[0] as HTMLElement).getByRole('link', { name: /\bNote 1\b/ }))
      .toBeVisible();
    test
      .expect(test.within(groups[0] as HTMLElement).getByRole('link', { name: /\bNote 3\b/ }))
      .toBeVisible();
    test
      .expect(test.within(groups[0] as HTMLElement).queryByRole('link', { name: /\bNote 2\b/ }))
      .toBeNull();
    test.expect(groups[1]).not.toHaveAttribute('open');
    test.fireEvent.click(test.within(groups[1] as HTMLElement).getByText('SidebarSettled'));
    test
      .expect(
        await test.within(groups[1] as HTMLElement).findByRole('link', { name: /\bNote 2\b/ })
      )
      .toBeInTheDocument();
    test.expect(api.summaries).toHaveBeenCalledTimes(1);
    await test.act(async () => {
      preferences = {
        ...defaultWorkspacePreferences,
        sidebarDensity: 'compact'
      };
      await cache.notify();
    });
    const compact = test.screen.getByRole('link', { name: /\bNote 1\b/ });

    await test.waitFor(() => test.expect(compact).toHaveAttribute('data-layout', 'compact'));
    test.expect(test.within(compact).getByTitle('SidebarGeneratedPages')).toHaveTextContent('1');
    test.expect(test.within(compact).getByText('SidebarReady')).toBeInTheDocument();
    test
      .expect(
        test.within(idleRow).getByRole('button', { name: 'SidebarTurnIntoPage' }).parentElement
      )
      .toBe(test.within(idleRow).getByRole('button', { name: 'SidebarSettle' }).parentElement);
    test
      .expect(test.within(generatingRow).queryByRole('button', { name: 'SidebarTurnIntoPage' }))
      .toBeNull();
    test
      .expect(
        test
          .within(test.screen.getByRole('link', { name: /\bNote 3\b/ }))
          .getByText('SidebarGenerating')
      )
      .toBeInTheDocument();
    await test.act(async () => {
      preferences = {
        ...defaultWorkspacePreferences,
        sidebarDensity: 'compact',
        sidebarShowPageCounts: false
      };
      await cache.notify();
    });
    await test.waitFor(() =>
      test
        .expect(test.within(compact).queryByTitle('SidebarGeneratedPages'))
        .not.toBeInTheDocument()
    );
  }
);

test.stable(
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
    const cache = fixture();

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
    const view = test.render(
      <cache.wrapper>
        <RouterProvider router={router} />
      </cache.wrapper>
    );
    const settle = await test.screen.findByRole('button', { name: 'SidebarSettle' });

    test.fireEvent.click(settle);
    await test.waitFor(() =>
      test.expect(api.settle).toHaveBeenCalledWith({ id: 1n, settled: true })
    );
    await test.waitFor(() =>
      test
        .expect(view.container.querySelector('.study-note-group:last-child .study-note-title'))
        .toHaveTextContent('Note 1')
    );
    const group = view.container.querySelector('.study-note-group:last-child') as HTMLElement;

    test.fireEvent.click(test.within(group).getByText('SidebarSettled'));
    await test.waitFor(() =>
      test.expect(test.within(group).getByRole('button', { name: 'SidebarReopen' })).toBeVisible()
    );
    test
      .expect(test.within(group).queryByRole('button', { name: 'SidebarTurnIntoPage' }))
      .not.toBeInTheDocument();
    test.fireEvent.click(test.within(group).getByRole('button', { name: 'SidebarReopen' }));
    await test.waitFor(() =>
      test.expect(api.settle).toHaveBeenLastCalledWith({ id: 1n, settled: false })
    );
    await test.waitFor(() =>
      test
        .expect(view.container.querySelector('.study-note-group:first-child .study-note-title'))
        .toHaveTextContent('Note 1')
    );
    test.expect(router.state.location.pathname).toBe('/');
  }
);

test.stable(
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
    const cache = fixture();

    const route = createRootRoute({
      component: () => (
        <RichSidebarNotes notes={many} subjects={[]} project={undefined} selectedNote={null} />
      )
    });
    const router = createRouter({
      routeTree: route,
      history: createMemoryHistory({ initialEntries: ['/'] })
    });
    const view = test.render(
      <cache.wrapper>
        <RouterProvider router={router} />
      </cache.wrapper>
    );

    const summary = await test.screen.findByText('SidebarSettled');
    const group = summary.closest('details')!;

    test.expect(group).not.toHaveAttribute('open');
    test.fireEvent.click(summary);
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('link', { name: /\bSettled 1\b/ }))
        .toHaveAttribute('data-layout', 'summary')
    );
    const first = test.screen.getByRole('link', { name: /\bSettled 1\b/ });

    test.expect(group).toHaveAttribute('open');
    test.expect(group).toHaveAttribute('data-variant', 'settled');
    test.expect(test.within(group).getAllByRole('link')).toHaveLength(10);
    test.expect(first).toHaveAttribute('data-layout', 'summary');
    test.expect(first.querySelector('time')).toBeInTheDocument();
    test.expect(test.within(first).queryByText('SidebarReady')).not.toBeInTheDocument();
    test.expect(group.querySelector('summary')).toHaveTextContent('40');
    test.fireEvent.click(test.within(group).getByRole('button', { name: 'SidebarShowMore' }));
    test.expect(test.within(group).getAllByRole('link')).toHaveLength(35);
    test.fireEvent.click(test.within(group).getByRole('button', { name: 'SidebarShowMore' }));
    test.expect(test.within(group).getAllByRole('link')).toHaveLength(40);
    test
      .expect(test.within(group).queryByRole('button', { name: 'SidebarShowMore' }))
      .not.toBeInTheDocument();
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
  const cache = fixture();

  const route = createRootRoute({
    component: () => (
      <RichSidebarNotes notes={notes} subjects={[]} project={undefined} selectedNote={null} />
    )
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  test.render(
    <cache.wrapper>
      <RouterProvider router={router} />
    </cache.wrapper>
  );

  return router;
}

test.stable(
  'starts selection from a row context menu and creates one document from the selected rows without navigating',
  async () => {
    const router = mountSelectionSidebar();

    test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: /\bNote 1\b/ }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    test.fireEvent.click(await test.screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    test
      .expect(await test.screen.findByRole('button', { name: /\bNote 1\b/ }))
      .toHaveAttribute('aria-pressed', 'true');
    test.fireEvent.click(test.screen.getByRole('button', { name: /\bNote 2\b/ }));
    test
      .expect(test.screen.getByRole('button', { name: /\bNote 2\b/ }))
      .toHaveAttribute('aria-pressed', 'true');
    const row = test.screen.getByRole('button', { name: /\bNote 1\b/ });

    test.expect(row).toHaveAttribute('data-layout', 'detailed');
    test.expect(await test.within(row).findByText('SidebarReady')).toBeVisible();
    test.expect(test.within(row).getByTitle('SidebarGeneratedPages')).toBeVisible();
    test.expect(test.screen.queryByRole('checkbox')).not.toBeInTheDocument();
    test.expect(router.state.location.pathname).toBe('/');
    const toolbar = test.screen.getByRole('toolbar', { name: 'SidebarSelectionActions' });

    test.expect(toolbar.parentElement).toBe(document.body);
    test.fireEvent.click(test.within(toolbar).getByRole('button', { name: 'NoteCreatePage' }));
    const dialog = await test.screen.findByRole('dialog', { name: 'NoteTransform' });

    test.expect(test.within(dialog).getByText('Note 1')).toBeVisible();
    test.expect(test.within(dialog).getByText('Note 2')).toBeVisible();
    test.expect(test.within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    test.expect(test.within(dialog).queryByRole('searchbox')).not.toBeInTheDocument();
  }
);

test.stable(
  'disables batch actions for zero selected rows and cancel returns to navigation',
  async () => {
    mountSelectionSidebar();
    test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: /\bNote 1\b/ }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    test.fireEvent.click(await test.screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    test.fireEvent.click(await test.screen.findByRole('button', { name: /\bNote 1\b/ }));
    const toolbar = test.screen.getByRole('toolbar', { name: 'SidebarSelectionActions' });

    test.expect(toolbar).toHaveFocus();
    test
      .expect(test.within(toolbar).getByRole('button', { name: 'NoteCreatePage' }))
      .toBeDisabled();
    test
      .expect(test.within(toolbar).getByRole('button', { name: 'SidebarDeleteSelected' }))
      .toBeDisabled();
    test.fireEvent.click(test.within(toolbar).getByRole('button', { name: 'Cancel' }));
    test.expect(await test.screen.findByRole('link', { name: /\bNote 1\b/ })).toBeVisible();
    test.expect(test.screen.getByRole('link', { name: /\bNote 1\b/ })).toHaveFocus();
    test.expect(test.screen.queryByRole('checkbox')).not.toBeInTheDocument();
    test
      .expect(test.screen.queryByRole('toolbar', { name: 'SidebarSelectionActions' }))
      .not.toBeInTheDocument();
  }
);

test.stable(
  'opens deletion review for the selected notes without deleting on selection',
  async () => {
    mountSelectionSidebar();
    test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: /\bNote 1\b/ }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    test.fireEvent.click(await test.screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    test.fireEvent.click(await test.screen.findByRole('button', { name: /\bNote 3\b/ }));
    test.fireEvent.click(
      test
        .within(test.screen.getByRole('toolbar'))
        .getByRole('button', { name: 'SidebarDeleteSelected' })
    );
    const dialog = await test.screen.findByRole('alertdialog');

    test.expect(test.within(dialog).getByText('Note 1')).toBeVisible();
    test.expect(test.within(dialog).getByText('Note 3')).toBeVisible();
    test.expect(test.within(dialog).queryByText('Note 2')).not.toBeInTheDocument();
  }
);

test.stable('keeps loaded settled rows available regardless of the sidebar height', async () => {
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
  const geometry = test.vi
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

  test.vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}
    }
  );
  const cache = fixture();

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

    test.render(
      <cache.wrapper>
        <RouterProvider router={router} />
      </cache.wrapper>
    );
    test.fireEvent.click(await test.screen.findByText('SidebarSettled'));
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('link', { name: /\bRecent 1\b/ }))
        .toHaveAttribute('data-layout', 'summary')
    );
    const group = test.screen.getByRole('link', { name: /\bRecent 1\b/ }).closest('details')!;

    test.expect(test.within(group).getAllByRole('link')).toHaveLength(7);
    test
      .expect(test.within(group).queryByRole('button', { name: 'SidebarShowMore' }))
      .not.toBeInTheDocument();
  } finally {
    geometry.mockRestore();
    test.vi.unstubAllGlobals();
  }
});

test.stable(
  'uses keyboard row toggles without changing the sidebar density or navigating',
  async () => {
    const router = mountSelectionSidebar();
    const original = await test.screen.findByRole('link', { name: /\bNote 1\b/ });

    test.expect(original).toHaveAttribute('data-layout', 'detailed');
    test.fireEvent.contextMenu(original, { button: 2, clientX: 80, clientY: 80 });
    test.fireEvent.click(await test.screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
    const row = await test.screen.findByRole('button', { name: /\bNote 2\b/ });

    test.expect(row).toHaveAttribute('data-layout', 'detailed');
    test.expect(row).toHaveAttribute('aria-pressed', 'false');
    row.focus();
    await test.userEvent.setup().keyboard(' ');
    test.expect(row).toHaveAttribute('aria-pressed', 'true');
    await test.userEvent.setup().keyboard('{Enter}');
    test.expect(row).toHaveAttribute('aria-pressed', 'false');
    test.expect(await test.within(row).findByText('SidebarReady')).toBeVisible();
    test.expect(router.state.location.pathname).toBe('/');
  }
);

test.stable(
  'opens the conversion dialog from a row without navigating or settling it',
  async () => {
    const router = mountSelectionSidebar();
    const link = await test.screen.findByRole('link', { name: /\bNote 1\b/ });
    const row = link.closest('.study-note-entry') as HTMLElement;

    test
      .expect(test.within(row).getByRole('button', { name: 'SidebarSettle' }))
      .toBeInTheDocument();
    test.fireEvent.click(test.within(row).getByRole('button', { name: 'SidebarTurnIntoPage' }));
    const dialog = await test.screen.findByRole('dialog', { name: 'NoteTransform' });

    test.expect(test.within(dialog).getByText('Note 1')).toBeVisible();
    test.expect(test.within(dialog).queryByText('Note 2')).not.toBeInTheDocument();
    test.expect(router.state.location.pathname).toBe('/');
  }
);

test.stable('offers merge only after selecting at least two notes', async () => {
  api.settings.mockResolvedValue({ settledPageThreshold: 1 });
  api.summaries.mockResolvedValue({ items: [] });
  const cache = fixture();

  const route = createRootRoute({
    component: () => (
      <RichSidebarNotes notes={notes} subjects={[]} project={undefined} selectedNote={null} />
    )
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  test.render(
    <cache.wrapper>
      <RouterProvider router={router} />
    </cache.wrapper>
  );
  test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: /\bNote 1\b/ }));
  test.fireEvent.click(await test.screen.findByRole('menuitem', { name: 'SidebarSelectNotes' }));
  test.expect(test.screen.getByRole('button', { name: 'NoteMerge' })).toBeDisabled();
  test.fireEvent.click(test.screen.getByRole('button', { name: /\bNote 2\b/ }));
  test.expect(test.screen.getByRole('button', { name: 'NoteMerge' })).toBeEnabled();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteMerge' }));
  const dialog = await test.screen.findByRole('dialog');

  test.expect(test.within(dialog).getByText('NoteMergeHelp')).toBeInTheDocument();
  test.expect(test.within(dialog).getByText('Note 1')).toBeInTheDocument();
  test.expect(test.within(dialog).getByText('Note 2')).toBeInTheDocument();
});
