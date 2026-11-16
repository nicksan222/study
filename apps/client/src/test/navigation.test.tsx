import { StudyError, noteIdSchema, projectIdSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { App } from '../app/app';

const pages = ['Notes', 'Projects', 'Flashcards', 'Practice'] as const;

test.beforeEach(() => {
  history.replaceState(null, '', '/');
});

test.stable.for(pages)(
  'renders the %s route without network access',
  async (page, { rpc, vi, render, expect, screen }) => {
    history.replaceState(null, '', `/${page.toLowerCase()}`);
    const fetch = vi.spyOn(globalThis, 'fetch');

    rpc.givenWorkspace();

    render(<App transport={rpc.transport} />);
    const title = catalogs.english[page];

    if (page === 'Practice' || page === 'Flashcards') {
      expect(await screen.findByRole('main')).toHaveTextContent(/^$/);
      expect(
        screen.getByRole('button', { name: catalogs.english.PracticeGenerate })
      ).toBeInTheDocument();
    } else {
      expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
      expect(screen.getByRole('main')).toHaveTextContent(
        page === 'Notes' ? catalogs.english.NoteStartHelp : catalogs.english.AppName
      );
    }

    expect(fetch).not.toHaveBeenCalled();
  }
);

test.stable(
  'opens settings over the current page and restores focus without changing the URL',
  async ({ rpc, userEvent, render, expect, screen, waitFor }) => {
    const user = userEvent.setup();

    history.replaceState(null, '', '/projects/1/notes/42');
    rpc.givenWorkspace();
    rpc.given({
      'notes.noteWork': { items: [], next: null },
      'notes.noteSelection': { revision: 0n, targets: [] },
      'notes.noteGenerations': { items: [], next: null },
      'notes.archivedItems': [],
      'notes.note': {
        id: noteIdSchema.make(42n),
        title: 'Existing note',
        titleSource: 'user',
        projectIds: [projectIdSchema.make(1n)],
        archivedAt: null,
        createdAt: 1n,
        updatedAt: 1n
      }
    });
    rpc.handle({
      'notes.noteDeletion': () => {
        throw new StudyError('not_found', 'No deletion operation');
      }
    });

    render(<App transport={rpc.transport} />);
    expect(
      await screen.findByRole('button', { name: catalogs.english.ToggleSidebar })
    ).toHaveAttribute('aria-expanded', 'true');
    const trigger = await screen.findByRole('button', { name: catalogs.english.Settings });

    await user.click(trigger);
    expect(
      await screen.findByRole('dialog', { name: catalogs.english.Settings })
    ).toBeInTheDocument();
    expect(location.pathname + location.search).toBe('/projects/1/notes/42');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole('heading', { name: catalogs.english.Notes })).toBeInTheDocument();
  }
);

test.stable(
  'opens the appearance popup from its direct settings route',
  async ({ rpc, render, expect, screen }) => {
    history.replaceState(null, '', '/settings');
    rpc.givenWorkspace();

    render(<App transport={rpc.transport} />);
    expect(
      await screen.findByRole('dialog', { name: catalogs.english.Settings })
    ).toBeInTheDocument();
  }
);

test.stable(
  'keeps Settings reachable while the sidebar is collapsed',
  async ({ rpc, userEvent, render, screen, expect, waitFor }) => {
    const user = userEvent.setup();

    history.replaceState(null, '', '/projects');
    rpc.givenWorkspace();

    render(<App transport={rpc.transport} />);
    await screen.findByRole('heading', { name: catalogs.english.Projects });

    const toggle = screen.getByRole('button', { name: catalogs.english.ToggleSidebar });

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: catalogs.english.Settings }));
    expect(
      await screen.findByRole('heading', { name: catalogs.english.Settings })
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
);
