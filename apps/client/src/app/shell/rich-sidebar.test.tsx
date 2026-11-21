import { noteSchema, defaultWorkspacePreferences } from '@study/contracts';
import { test } from '@study/testing';
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider
} from '@tanstack/react-router';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';

import type * as __StudyMockType0 from '#client/app/shell/rich-sidebar.tsx';

let RichSidebarNotes: typeof __StudyMockType0.RichSidebarNotes;

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english', date: String })
  }));
  const __studyMockModule0 = await import('./rich-sidebar');

  RichSidebarNotes = __studyMockModule0.RichSidebarNotes;
});

let preferences = defaultWorkspacePreferences;

function fixture(
  { rpcTestTransport }: Pick<test.unit.Context, 'rpcTestTransport'>,
  registry?: AtomRegistry.AtomRegistry
) {
  return rpcTestTransport(async (tag) => {
    if (tag === 'settings.workspacePreferences') return preferences;

    if (tag === 'notes.noteSummaries')
      return {
        items: [
          { id: 1n, generatedPageCount: 5n, running: false, activity: 'idle' },
          { id: 2n, generatedPageCount: 0n, running: false, activity: 'idle' },
          { id: 3n, generatedPageCount: 1n, running: true, activity: 'generating' }
        ]
      };

    throw new Error(tag);
  }, registry);
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
  'shows every saved note in one list with the chosen density',
  async ({ render, screen, expect, act, waitFor, within, rpcTestTransport }) => {
    const cache = fixture({ rpcTestTransport });
    const route = createRootRoute({
      component: () => (
        <RichSidebarNotes
          notes={notes.map((note) => (note.id === 2n ? { ...note, archivedAt: 3n } : note))}
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

    render(
      <cache.wrapper>
        <RouterProvider router={router} />
      </cache.wrapper>
    );

    await screen.findByText('SidebarGenerating');
    const rows = screen.getAllByRole('link', { name: /\bNote [123]\b/ });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.getAttribute('data-note-id'))).toEqual(['1', '2', '3']);

    for (const row of rows) expect(row).toHaveAttribute('data-layout', 'detailed');

    expect(rows[0]).toHaveAttribute('aria-current', 'page');
    expect(within(rows[0]!).getByTitle('SidebarGeneratedPages')).toHaveTextContent('5');
    expect(within(rows[1]!).queryByTitle('SidebarGeneratedPages')).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText('SidebarGenerating')).toBeVisible();

    await act(async () => {
      preferences = {
        ...defaultWorkspacePreferences,
        sidebarDensity: 'compact'
      };
      await cache.notify();
    });
    await waitFor(() => {
      for (const row of rows) {
        expect(row).toHaveAttribute('data-layout', 'compact');
      }
    });
  }
);

test.unit.stable(
  'shows one draft before saved notes and reveals the next retained draft after dismissal',
  async ({ render, screen, expect, userEvent, rpcTestTransport }) => {
    const { startDraft, startDrafts } = await import('#client/features/note-workspace/index.ts');
    const registry = AtomRegistry.make();
    const view = fixture({ rpcTestTransport }, registry);
    const olderDraft = startDraft('unassigned');
    const recentDraft = startDraft('2');

    registry.set(olderDraft, 'Previous draft');
    registry.set(recentDraft, 'Latest draft');
    registry.set(startDrafts, ['2', 'unassigned']);
    const route = createRootRoute({
      component: () => (
        <RichSidebarNotes notes={notes} subjects={[]} project={undefined} selectedNote={null} />
      )
    });
    const router = createRouter({
      routeTree: route,
      history: createMemoryHistory({ initialEntries: ['/'] })
    });

    try {
      render(
        <view.wrapper>
          <RouterProvider router={router} />
        </view.wrapper>
      );
      const draft = await screen.findByRole('link', { name: /Latest draft/ });
      const firstNote = screen.getByRole('link', { name: /Note 1/ });

      expect(screen.queryByRole('link', { name: /Previous draft/ })).toBeNull();
      expect(draft.closest('.study-saved-notes')?.querySelector('a')).toBe(draft);
      expect(firstNote).toBeVisible();
      expect(registry.get(olderDraft)).toBe('Previous draft');
      await userEvent.setup().click(screen.getByRole('button', { name: 'SidebarDismissDraft' }));
      expect(await screen.findByRole('link', { name: /Previous draft/ })).toBeVisible();
      expect(screen.queryByRole('link', { name: /Latest draft/ })).toBeNull();
      expect(registry.get(recentDraft)).toBe('');
    } finally {
      registry.dispose();
    }
  }
);

function mountSelectionSidebar({
  render,
  rpcTestTransport
}: Pick<test.unit.Context, 'render' | 'rpcTestTransport'>) {
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
  'starts selection from a row context menu without navigating',
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
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    const toolbar = screen.getByRole('toolbar', { name: 'SidebarSelectionActions' });

    expect(toolbar.parentElement).toBe(document.body);
    expect(within(toolbar).queryByRole('button', { name: 'NoteCreatePage' })).toBeNull();
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
    expect(within(toolbar).queryByRole('button', { name: 'NoteCreatePage' })).toBeNull();
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
  'uses keyboard row toggles without changing the sidebar density or navigating',
  async ({ screen, expect, fireEvent, userEvent, render, rpcTestTransport }) => {
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
    expect(router.state.location.pathname).toBe('/');
  }
);

test.unit.stable(
  'offers merge only after selecting at least two notes',
  async ({ render, fireEvent, screen, expect, within, rpcTestTransport }) => {
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
