import { StudyError, noteIdSchema, projectIdSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { App } from '../app/app';

const pages = ['Notes', 'Projects', 'Flashcards', 'Practice'] as const;

test.beforeEach(() => {
  history.replaceState(null, '', '/');
});

test.stable.for(pages)('renders the %s route without network access', async (page, { rpc }) => {
  history.replaceState(null, '', `/${page.toLowerCase()}`);
  const fetch = test.vi.spyOn(globalThis, 'fetch');

  rpc.givenWorkspace();

  test.render(<App transport={rpc.transport} />);
  const title = catalogs.english[page];

  if (page === 'Practice' || page === 'Flashcards') {
    test.expect(await test.screen.findByRole('main')).toHaveTextContent(/^$/);
    test
      .expect(test.screen.getByRole('button', { name: catalogs.english.PracticeGenerate }))
      .toBeInTheDocument();
  } else {
    test
      .expect(await test.screen.findByRole('heading', { name: title, level: 1 }))
      .toBeInTheDocument();
    test
      .expect(test.screen.getByRole('main'))
      .toHaveTextContent(
        page === 'Notes' ? catalogs.english.NoteStartHelp : catalogs.english.AppName
      );
  }

  test.expect(fetch).not.toHaveBeenCalled();
});

test.stable(
  'opens settings over the current page and restores focus without changing the URL',
  async ({ rpc }) => {
    const user = test.userEvent.setup();

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

    test.render(<App transport={rpc.transport} />);
    test
      .expect(await test.screen.findByRole('button', { name: catalogs.english.ToggleSidebar }))
      .toHaveAttribute('aria-expanded', 'true');
    const trigger = await test.screen.findByRole('button', { name: catalogs.english.Settings });

    await user.click(trigger);
    test
      .expect(await test.screen.findByRole('dialog', { name: catalogs.english.Settings }))
      .toBeInTheDocument();
    test.expect(location.pathname + location.search).toBe('/projects/1/notes/42');
    await user.keyboard('{Escape}');
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await test.waitFor(() => test.expect(trigger).toHaveFocus());
    test
      .expect(test.screen.getByRole('heading', { name: catalogs.english.Notes }))
      .toBeInTheDocument();
  }
);

test.stable('opens the appearance popup from its direct settings route', async ({ rpc }) => {
  history.replaceState(null, '', '/settings');
  rpc.givenWorkspace();

  test.render(<App transport={rpc.transport} />);
  test
    .expect(await test.screen.findByRole('dialog', { name: catalogs.english.Settings }))
    .toBeInTheDocument();
});

test.stable('keeps Settings reachable while the sidebar is collapsed', async ({ rpc }) => {
  const user = test.userEvent.setup();

  history.replaceState(null, '', '/projects');
  rpc.givenWorkspace();

  test.render(<App transport={rpc.transport} />);
  await test.screen.findByRole('heading', { name: catalogs.english.Projects });

  const toggle = test.screen.getByRole('button', { name: catalogs.english.ToggleSidebar });

  test.expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await user.click(toggle);
  test.expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await user.click(test.screen.getByRole('button', { name: catalogs.english.Settings }));
  test
    .expect(await test.screen.findByRole('heading', { name: catalogs.english.Settings }))
    .toBeInTheDocument();
  await user.keyboard('{Escape}');
  await test.waitFor(() => test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument());

  await user.click(toggle);
  test.expect(toggle).toHaveAttribute('aria-expanded', 'true');
});
