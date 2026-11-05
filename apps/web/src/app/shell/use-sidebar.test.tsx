import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { SessionStart } from '#web/features/session-workspace/start.tsx';

import { App } from '../app';

vi.mock('#web/features/session-workspace/workspace.tsx', () => ({
  SessionWorkspace: ({ id }: { id?: bigint }) => (id ? null : <SessionStart />)
}));

vi.mock('#web/features/authored-documents/reader-page.tsx', () => ({ DocumentPage: () => null }));

const api = vi.hoisted(() => ({
  projects: vi.fn(),
  sessions: vi.fn(),
  session: vi.fn(),
  sources: vi.fn(),
  materials: vi.fn(),
  documents: vi.fn(),
  document: vi.fn(),
  search: vi.fn(),
  createProject: vi.fn(),
  createSession: vi.fn()
}));

vi.mock('#web/lib/study-client/client.ts', async () => {
  const { Effect, Schema } = await import('effect');
  const { materialSummarySchema } = await import('@study/contracts/materials/schemas');
  const summary = (item: {
    id: bigint;
    kind: string;
    title: string;
    projectIds: bigint[];
    updated_at: bigint;
  }) => {
    const version = {
      id: item.id + 1000n,
      material_id: item.id,
      kind: item.kind,
      number: 1n,
      status: 'published',
      operation: 'original',
      creator: 'user',
      instruction: null,
      language: null,
      created_at: 0n,
      published_at: 0n
    };

    return Schema.decodeUnknownSync(materialSummarySchema)({
      ...item,
      created_at: 0n,
      archived_at: null,
      version,
      latestPublishedVersion: version,
      latestDraftVersion: null
    });
  };
  const call = (fn: typeof api.projects) => (input: unknown) => Effect.tryPromise(() => fn(input));
  const client = {
    'projects.projects': call(api.projects),
    'projects.createProject': call(api.createProject),
    'sources.sources': call(api.sources),
    'documents.documents': call(api.documents),
    'documents.document': call(api.document),
    'materials.materials': (input: unknown) =>
      Effect.tryPromise(async () => {
        const page = await api.materials(input);

        return { ...page, items: page.items.map(summary) };
      }),
    'system.search': call(api.search),
    'conversations.sessions': call(api.sessions),
    'conversations.session': call(api.session),
    'conversations.createUntitledSession': call(api.createSession)
  };

  return {
    studyClient: Effect.succeed(client)
  };
});

const en = catalogs.english;

async function renderWithNavigation() {
  render(<App />);
  const toggle = await screen.findByRole('button', { name: en.ToggleSidebar });

  if (toggle.getAttribute('aria-expanded') === 'false') {
    await userEvent.setup().click(toggle);
  }
}

const subjects = [
  { id: 1n, name: 'Biology', examOn: null, createdAt: 0n, updatedAt: 0n },
  { id: 2n, name: 'History', examOn: null, createdAt: 0n, updatedAt: 0n }
];

beforeEach(() => {
  history.replaceState(null, '', '/projects/1/sessions/42');
  api.session.mockReset().mockResolvedValue({ id: 42n, projectIds: [1n] });
  api.projects.mockResolvedValue({ items: subjects });
  api.sources.mockReset().mockResolvedValue({ items: [] });
  api.materials.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  api.documents.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  api.document.mockReset().mockResolvedValue({ id: 10n, projectIds: [1n] });
  api.sessions.mockResolvedValue({
    items: [
      {
        id: 42n,
        projectIds: [1n],
        title: 'Cell division',
        titleSource: 'user',
        createdAt: 0n,
        updatedAt: 0n
      },
      {
        id: 43n,
        projectIds: [2n],
        title: 'Roman Republic',
        titleSource: 'user',
        createdAt: 0n,
        updatedAt: 0n
      }
    ]
  });
  api.search.mockReset().mockResolvedValue({ hits: [], semantic: true });
  api.createSession.mockReset().mockResolvedValue({ id: 7n });
});

testStable(
  'switches subjects while keeping the section and clearing the selected item',
  async () => {
    const user = userEvent.setup();

    await renderWithNavigation();
    await user.click(await screen.findByLabelText('Biology'));
    await user.click(await screen.findByRole('option', { name: 'History' }));
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/2/sessions'));
    expect(await screen.findByLabelText('History')).toBeInTheDocument();
  }
);

testStable('searches within the selected subject and opens a result', async () => {
  api.search.mockResolvedValue({
    semantic: true,
    hits: [
      {
        kind: 'session',
        title: 'Cell division',
        at: 0n,
        target: { type: 'session', sessionId: 9n }
      }
    ]
  });
  const user = userEvent.setup();

  await renderWithNavigation();
  await screen.findByLabelText('Biology');
  await user.type(screen.getByRole('searchbox'), 'cell');
  await user.click(await screen.findByRole('link', { name: /Cell division/ }));
  expect(api.search).toHaveBeenLastCalledWith({
    query: 'cell',
    project: 1n,
    limit: 30,
    kinds: ['session', 'message']
  });
  await waitFor(() => expect(location.pathname + location.search).toBe('/projects/1/sessions/9'));
});

testStable(
  'opens one local draft in the selected subject without persisting an empty session',
  async () => {
    const user = userEvent.setup();

    await renderWithNavigation();
    await screen.findByLabelText('Biology');
    await user.click(
      within(screen.getByRole('complementary', { name: en.SidebarNavigation })).getByRole(
        'button',
        { name: en.NewSession }
      )
    );
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/1/sessions'));
    expect(api.createSession).not.toHaveBeenCalled();
    expect(await screen.findByRole('textbox', { name: en.SessionCompose })).toHaveValue('');
    expect(screen.getByRole('button', { name: en.SessionSaveNote })).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: en.SessionCompose }),
      'Unsent biology notes'
    );
    const sidebar = within(screen.getByRole('complementary', { name: en.SidebarNavigation }));
    const draft = await sidebar.findByRole('link', { name: 'Unsent biology notes' });

    expect(draft.closest('details')).toBeNull();
    expect(draft.closest('.study-session-entry')).toBe(
      draft.closest('.study-session-groups')?.firstElementChild
    );
  }
);

testStable('does not search another subject when the URL subject is missing', async () => {
  history.replaceState(null, '', '/projects/99/sessions');
  const user = userEvent.setup();

  await renderWithNavigation();
  await screen.findByText(en.SubjectNotFound);
  await user.type(screen.getByRole('searchbox'), 'cell');
  expect(api.search).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole('complementary', { name: en.SidebarNavigation })).getByRole('button', {
      name: en.NewSession
    })
  );
  await waitFor(() => expect(location.pathname + location.search).toBe('/sessions'));
  expect(api.createSession).not.toHaveBeenCalled();
});

testStable('opens search from the collapsed rail with the keyboard shortcut', async () => {
  const user = userEvent.setup();

  await renderWithNavigation();
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('button', { name: en.ToggleSidebar }));
  await user.keyboard('{Control>}k{/Control}');
  await waitFor(() => expect(screen.getByRole('searchbox')).toHaveFocus());
});

testStable('creates a subject from the toolbar and selects it', async () => {
  api.createProject.mockResolvedValue({ ...subjects[0], id: 3n, name: 'Physics' });
  const user = userEvent.setup();

  await renderWithNavigation();
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('button', { name: en.NewProject }));
  await user.type(screen.getByRole('textbox', { name: en.ProjectName }), 'Physics');
  await user.click(screen.getByRole('button', { name: en.CreateProject }));
  expect(api.createProject).toHaveBeenCalledWith({ name: 'Physics' });
  await waitFor(() => expect(location.pathname + location.search).toBe('/projects/3/sessions'));
});

testStable('searches globally on Help while retaining the subject for navigation', async () => {
  history.replaceState(null, '', '/projects/1/help');
  const user = userEvent.setup();

  await renderWithNavigation();
  await screen.findByLabelText('Biology');
  await user.type(screen.getByRole('searchbox'), 'cell');
  await waitFor(() =>
    expect(api.search).toHaveBeenLastCalledWith({ query: 'cell', project: undefined, limit: 30 })
  );
});

testStable('lets the keyboard search and dismiss the subject picker', async () => {
  const user = userEvent.setup();

  await renderWithNavigation();
  const picker = await screen.findByLabelText('Biology');

  picker.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByLabelText(en.FindSubject)).toHaveFocus());
  await user.clear(screen.getByLabelText(en.FindSubject));
  await user.type(screen.getByLabelText(en.FindSubject), 'Hist');
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(location.pathname + location.search).toBe('/projects/2/sessions'));
  screen.getByLabelText('History').focus();
  await user.keyboard('{Enter}{Escape}');
  await waitFor(() => expect(screen.queryByLabelText(en.FindSubject)).not.toBeInTheDocument());
});

testStable('ignores a subject list fetched before a new subject was created', async () => {
  const user = userEvent.setup();

  await renderWithNavigation();
  await screen.findByLabelText('Biology');
  let finish: (result: { items: typeof subjects }) => void = () => {};

  api.projects.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await user.click(screen.getByLabelText('Biology'));
  await waitFor(() => expect(screen.getByLabelText(en.FindSubject)).toHaveFocus());
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByLabelText(en.FindSubject)).not.toBeInTheDocument());
  api.createProject.mockResolvedValue({ ...subjects[0], id: 3n, name: 'Physics' });
  await user.click(screen.getByRole('button', { name: en.NewProject }));
  await user.type(screen.getByRole('textbox', { name: en.ProjectName }), 'Physics');
  await user.click(screen.getByRole('button', { name: en.CreateProject }));
  await screen.findByLabelText('Physics');
  await act(async () => {
    finish({ items: subjects });
  });
  expect(screen.getByLabelText('Physics')).toBeInTheDocument();
  expect(screen.queryByText(en.SubjectNotFound)).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('complementary', { name: en.SidebarNavigation })).getByRole('button', {
      name: en.NewSession
    })
  ).toBeEnabled();
});

testStable('searches session content without a sidebar filter control', async () => {
  const user = userEvent.setup();

  await renderWithNavigation();
  await screen.findByLabelText('Biology');
  expect(screen.queryByRole('button', { name: en.SearchFilter })).not.toBeInTheDocument();
  await user.type(screen.getByRole('searchbox'), 'cell');
  await waitFor(() =>
    expect(api.search).toHaveBeenLastCalledWith({
      query: 'cell',
      project: 1n,
      limit: 30,
      kinds: ['session', 'message']
    })
  );
});

testStable('uses the body for sessions and a labeled navigation block above settings', async () => {
  const user = userEvent.setup();

  await renderWithNavigation();
  await screen.findByLabelText('Biology');
  const session = await screen.findByRole('link', { name: 'Cell division' });

  expect(session.closest('nav')).toHaveAttribute('aria-label', en.Sessions);
  expect(session).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('link', { name: 'Roman Republic' })).not.toBeInTheDocument();
  const flashcards = screen.getByRole('link', { name: en.Practice });

  expect(flashcards.closest('nav')).toHaveClass('study-sidebar-navigation');
  expect(flashcards).toHaveTextContent(en.Practice);
  expect(screen.getByRole('button', { name: en.Settings })).toHaveTextContent(en.Settings);
  expect(screen.getByRole('button', { name: en.Settings }).closest('nav')).toHaveClass(
    'study-sidebar-footer'
  );
  await user.click(flashcards);
  await waitFor(() => expect(location.pathname + location.search).toBe('/projects/1/practice'));
  await user.click(screen.getByRole('link', { name: en.Sessions }));
  await user.click(await screen.findByRole('link', { name: 'Cell division' }));
  await waitFor(() => expect(location.pathname + location.search).toBe('/projects/1/sessions/42'));
});

testStable('lists flashcards and quizzes together and follows material pagination', async () => {
  api.materials.mockImplementation(({ cursor }) =>
    Promise.resolve(
      cursor
        ? {
            items: [
              { id: 22n, title: 'Cell quiz', projectIds: [1n], kind: 'quiz', updated_at: 0n }
            ],
            nextCursor: null
          }
        : {
            items: [
              {
                id: 21n,
                title: 'Cell cards',
                projectIds: [1n],
                kind: 'flashcards',
                updated_at: 0n
              }
            ],
            nextCursor: 21n
          }
    )
  );
  const user = userEvent.setup();

  await renderWithNavigation();
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('link', { name: en.Practice }));
  await screen.findByRole('link', { name: 'Cell cards' });
  expect(screen.getByRole('link', { name: 'Cell quiz' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Cell division' })).not.toBeInTheDocument();
  expect(api.materials).toHaveBeenLastCalledWith({
    projectId: 1n,
    cursor: 21n,
    limit: 100,
    archived: false
  });
  await user.click(screen.getByRole('link', { name: 'Cell cards' }));
  await waitFor(() =>
    expect(location.pathname + location.search).toBe('/projects/1/flashcards?material=21')
  );
});

testStable('loads later project and session pages', async () => {
  api.projects.mockImplementation(({ before }) =>
    Promise.resolve(
      before ? { items: [subjects[1]], next: null } : { items: [subjects[0]], next: 1n }
    )
  );
  api.sessions.mockImplementation(({ before }) =>
    Promise.resolve(
      before
        ? {
            items: [
              {
                id: 43n,
                projectIds: [1n],
                title: 'Later session',
                titleSource: 'user',
                createdAt: 0n,
                updatedAt: 0n
              }
            ],
            next: null
          }
        : { items: [], next: { id: 42n, updatedAt: 1n } }
    )
  );
  await renderWithNavigation();
  expect(await screen.findByRole('link', { name: 'Later session' })).toBeInTheDocument();
  const user = userEvent.setup();

  await user.click(await screen.findByLabelText('Biology'));
  expect(await screen.findByRole('option', { name: 'History' })).toBeInTheDocument();
});

testStable.each([['diagram'], ['flashcards'], ['quiz']])(
  'opens a %s search result on its own page',
  async (materialKind) => {
    history.replaceState(null, '', '/projects/1/help');
    api.search.mockResolvedValue({
      semantic: false,
      hits: [
        {
          kind: 'material',
          title: 'Cell study',
          at: 0n,
          target: { type: 'material', materialId: 8n, versionId: 9n, materialKind }
        }
      ]
    });
    const user = userEvent.setup();

    await renderWithNavigation();
    await screen.findByLabelText('Biology');
    await user.type(screen.getByRole('searchbox'), 'cell');
    await user.click(await screen.findByRole('link', { name: /Cell study/ }));
    await waitFor(() => expect(location.pathname + location.search).toBe('/materials/8?version=9'));
  }
);

testStable('preserves projects loaded while project creation is in flight', async () => {
  let finishLoad!: (value: { items: typeof subjects; next: null }) => void;
  let finishCreate!: (value: (typeof subjects)[number]) => void;

  api.projects.mockReturnValue(
    new Promise((resolve) => {
      finishLoad = resolve;
    })
  );
  api.createProject.mockReturnValue(
    new Promise((resolve) => {
      finishCreate = resolve;
    })
  );
  const user = userEvent.setup();

  await renderWithNavigation();
  await user.click(await screen.findByRole('button', { name: en.NewProject }));
  await user.type(screen.getByRole('textbox', { name: en.ProjectName }), 'Physics');
  await user.click(screen.getByRole('button', { name: en.CreateProject }));
  await act(async () => {
    finishLoad({ items: subjects, next: null });
  });
  api.projects.mockReturnValue(new Promise(() => {}));
  await act(async () => {
    finishCreate({ ...subjects[0], id: 3n, name: 'Physics' });
  });
  await user.click(await screen.findByLabelText('Physics'));
  expect(await screen.findByRole('option', { name: 'Biology' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'History' })).toBeInTheDocument();
});

testStable(
  'first send adds a session to the sidebar and permits another lazy session',
  async () => {
    let finish!: (value: { items: [] }) => void;

    api.sessions.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const user = userEvent.setup();

    await renderWithNavigation();
    await screen.findByLabelText('Biology');
    api.sessions.mockResolvedValue({
      items: [
        {
          id: 7n,
          projectIds: [1n],
          title: 'Created session',
          titleSource: 'user',
          createdAt: 0n,
          updatedAt: 0n
        }
      ]
    });
    api.createSession.mockResolvedValue({
      id: 7n,
      projectIds: [1n],
      title: 'Created session',
      titleSource: 'provisional',
      createdAt: 0n,
      updatedAt: 0n
    });
    await user.click(
      within(screen.getByRole('complementary', { name: en.SidebarNavigation })).getByRole(
        'button',
        { name: en.NewSession }
      )
    );
    await user.type(await screen.findByRole('textbox', { name: en.SessionCompose }), 'First note');
    await user.click(screen.getByRole('button', { name: en.SessionSaveNote }));
    await waitFor(() => expect(location.pathname).toBe('/projects/1/sessions/7'));
    await act(async () => {
      finish({ items: [] });
    });
    expect(await screen.findByRole('link', { name: 'Created session' })).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('complementary', { name: en.SidebarNavigation })).getByRole(
        'button',
        { name: en.NewSession }
      )
    );
    const input = await screen.findByRole('textbox', { name: en.SessionCompose });

    expect(input).toHaveValue('');
    await user.type(input, 'Second note');
    expect(screen.getByRole('button', { name: en.SessionSaveNote })).toBeEnabled();
    const second = {
      id: 8n,
      projectIds: [1n],
      title: 'Second session',
      titleSource: 'provisional',
      createdAt: 0n,
      updatedAt: 0n
    };

    api.createSession.mockResolvedValueOnce(second);
    api.sessions.mockResolvedValue({ items: [second] });
    await user.click(screen.getByRole('button', { name: en.SessionSaveNote }));
    await waitFor(() => expect(location.pathname).toBe('/projects/1/sessions/8'));
    expect(await screen.findByRole('link', { name: 'Second session' })).toBeInTheDocument();
  }
);

testStable.each(['/sessions/42', '/projects/2/sessions/42'])(
  'uses the actual session owner for direct and mismatched links: %s',
  async (url) => {
    history.replaceState(null, '', url);
    await renderWithNavigation();
    expect(await screen.findByLabelText('Biology')).toBeVisible();
    expect(await screen.findByRole('link', { name: 'Cell division' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Roman Republic' })).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole('searchbox'), 'cell');
    await waitFor(() =>
      expect(api.search).toHaveBeenLastCalledWith({
        query: 'cell',
        project: 1n,
        limit: 30,
        kinds: ['session', 'message']
      })
    );
  }
);

testStable('does not reveal a foreign subject while session ownership is loading', async () => {
  history.replaceState(null, '', '/projects/2/sessions/42');
  api.session.mockReturnValue(new Promise(() => {}));
  await renderWithNavigation();
  expect(screen.queryByLabelText('History')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Roman Republic' })).not.toBeInTheDocument();
  await userEvent.setup().type(screen.getByRole('searchbox'), 'rome');
  expect(api.search).not.toHaveBeenCalled();
});

testStable('keeps projectless sessions independent of a foreign query parameter', async () => {
  history.replaceState(null, '', '/projects/2/sessions/42');
  api.session.mockResolvedValue({ id: 42n, projectIds: [] });
  await renderWithNavigation();
  await waitFor(() => expect(api.session).toHaveBeenCalled());
  expect(screen.queryByLabelText('History')).not.toBeInTheDocument();
});

testStable('retries a failed session owner read from the subject picker error', async () => {
  api.session.mockRejectedValue(new Error('offline'));
  await renderWithNavigation();
  const retry = await screen.findByRole('button', { name: en.SubjectsLoadError });

  api.session.mockResolvedValue({ id: 42n, projectIds: [1n] });
  await userEvent.setup().click(retry);
  expect(await screen.findByLabelText('Biology')).toBeVisible();
});

testStable.each(['/documents/10', '/projects/2/documents/10'])(
  'uses route-owned document context and shows only documents in the sidebar: %s',
  async (url) => {
    history.replaceState(null, '', url);
    api.documents.mockResolvedValue({
      items: [
        {
          id: 10n,
          title: 'Cell notes',
          projectIds: [1n],
          description: 'Cell study notes',
          createdAt: 0n,
          updatedAt: 0n,
          archivedAt: null,
          headVersionId: 101n
        }
      ],
      nextCursor: null
    });
    const user = userEvent.setup();

    await renderWithNavigation();
    expect(await screen.findByLabelText('Biology')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Cell division' })).not.toBeInTheDocument();
    const document = await screen.findByRole('link', { name: 'Cell notes' });

    expect(document).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: en.SourceDocument })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.queryByRole('link', { name: 'Roman Republic' })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Biology'));
    await user.click(await screen.findByRole('option', { name: 'History' }));
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/2/documents'));
  }
);

testStable(
  'opens Documents between Sessions and Practice with a documents-only sidebar',
  async () => {
    api.documents.mockResolvedValue({
      items: [
        {
          id: 10n,
          title: 'Cell notes',
          projectIds: [1n],
          description: 'Cell study notes',
          createdAt: 0n,
          updatedAt: 0n,
          archivedAt: null,
          headVersionId: 101n
        }
      ],
      nextCursor: null
    });
    const user = userEvent.setup();

    await renderWithNavigation();
    const sidebar = within(screen.getByRole('complementary', { name: en.SidebarNavigation }));

    expect(await sidebar.findByRole('link', { name: 'Cell division' })).toBeVisible();
    expect(sidebar.queryByRole('link', { name: 'Cell notes' })).not.toBeInTheDocument();
    const navigation = within(sidebar.getByRole('navigation', { name: en.SidebarNavigation }));

    expect(
      navigation
        .getAllByRole('link')
        .slice(0, 3)
        .map((link) => link.getAttribute('aria-label'))
    ).toEqual([en.Sessions, en.SourceDocument, en.Practice]);
    await user.click(navigation.getByRole('link', { name: en.SourceDocument }));
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/1/documents'));
    await sidebar.findByRole('link', { name: 'Cell notes' });
    expect(sidebar.queryByRole('link', { name: 'Cell division' })).not.toBeInTheDocument();
    expect(sidebar.queryByText(en.SidebarOpen)).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: en.DocumentsOverviewTitle, level: 2 })
    ).toBeVisible();
    await user.type(sidebar.getByRole('searchbox'), 'missing');
    expect(await sidebar.findByText(en.SearchNoResults)).toBeVisible();
    await user.clear(sidebar.getByRole('searchbox'));
    await user.click(await sidebar.findByRole('link', { name: 'Cell notes' }));
    await waitFor(() => expect(location.pathname).toBe('/projects/1/documents/10'));
    expect(await sidebar.findByRole('link', { name: 'Cell notes' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(sidebar.queryByRole('link', { name: 'Cell division' })).not.toBeInTheDocument();
  }
);
