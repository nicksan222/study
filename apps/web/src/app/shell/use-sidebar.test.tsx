import { catalogs } from '@study/localization';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { App } from '../app';

const api = vi.hoisted(() => ({
  projects: vi.fn(),
  sessions: vi.fn(),
  sources: vi.fn(),
  materials: vi.fn(),
  search: vi.fn(),
  createProject: vi.fn(),
  createSession: vi.fn()
}));

vi.mock('../../lib/study-client/client', async () => {
  const { Effect } = await import('effect');
  const call = (fn: typeof api.projects) => (input: unknown) => Effect.tryPromise(() => fn(input));
  const client = {
    'projects.projects': call(api.projects),
    'projects.createProject': call(api.createProject),
    'sources.sources': call(api.sources),
    'materials.materials': call(api.materials),
    'system.search': call(api.search),
    'conversations.sessions': call(api.sessions),
    'conversations.createUntitledSession': call(api.createSession)
  };

  return {
    studyClient: Effect.succeed(client)
  };
});

const en = catalogs.english;

const subjects = [
  { id: 1n, name: 'Biology', examOn: null, createdAt: 0n, updatedAt: 0n },
  { id: 2n, name: 'History', examOn: null, createdAt: 0n, updatedAt: 0n }
];

beforeEach(() => {
  history.replaceState(null, '', '/sessions?project=1&id=42');
  api.projects.mockResolvedValue({ items: subjects });
  api.sources.mockReset().mockResolvedValue({ items: [] });
  api.materials.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  api.sessions.mockResolvedValue({
    items: [
      {
        id: 42n,
        projectId: 1n,
        title: 'Cell division',
        titleSource: 'user',
        createdAt: 0n,
        updatedAt: 0n
      },
      {
        id: 43n,
        projectId: 2n,
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

it('switches subjects while keeping the section and clearing the selected item', async () => {
  const user = userEvent.setup();

  render(<App />);
  await user.click(await screen.findByLabelText('Biology'));
  await user.click(await screen.findByRole('option', { name: 'History' }));
  await waitFor(() => expect(location.pathname + location.search).toBe('/sessions?project=2'));
  expect(screen.getByLabelText('History')).toBeInTheDocument();
});

it('searches within the selected subject and opens a result', async () => {
  api.search.mockResolvedValue({
    semantic: true,
    hits: [
      {
        kind: 'session',
        title: 'Cell division',
        at: 0n,
        target: { type: 'session', projectId: 1n, sessionId: 9n }
      }
    ]
  });
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.type(screen.getByRole('searchbox'), 'cell');
  await user.click(await screen.findByRole('link', { name: /Cell division/ }));
  expect(api.search).toHaveBeenLastCalledWith({
    query: 'cell',
    project: 1n,
    limit: 30,
    kinds: ['session', 'message']
  });
  await waitFor(() => expect(location.pathname + location.search).toBe('/sessions?project=1&id=9'));
});

it('creates a real session in the selected subject', async () => {
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('button', { name: en.NewSession }));
  expect(api.createSession).toHaveBeenCalledWith({ project: 1n });
  await waitFor(() => expect(location.pathname + location.search).toBe('/sessions?project=1&id=7'));
});

it('does not search another subject when the URL subject is missing', async () => {
  history.replaceState(null, '', '/sessions?project=99');
  const user = userEvent.setup();

  render(<App />);
  await screen.findByText(en.SubjectNotFound);
  await user.type(screen.getByRole('searchbox'), 'cell');
  expect(api.search).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: en.NewSession })).toBeDisabled();
});

it('opens search from the collapsed rail with the keyboard shortcut', async () => {
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('button', { name: en.ToggleSidebar }));
  await user.keyboard('{Control>}k{/Control}');
  await waitFor(() => expect(screen.getByRole('searchbox')).toHaveFocus());
});

it('creates a subject from the toolbar and selects it', async () => {
  api.createProject.mockResolvedValue({ ...subjects[0], id: 3n, name: 'Physics' });
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('button', { name: en.NewProject }));
  await user.type(screen.getByRole('textbox', { name: en.ProjectName }), 'Physics');
  await user.click(screen.getByRole('button', { name: en.CreateProject }));
  expect(api.createProject).toHaveBeenCalledWith({ name: 'Physics' });
  await waitFor(() => expect(location.pathname + location.search).toBe('/sessions?project=3'));
});

it('searches globally on Settings while retaining the subject for navigation', async () => {
  history.replaceState(null, '', '/settings?project=1');
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.type(screen.getByRole('searchbox'), 'cell');
  await waitFor(() =>
    expect(api.search).toHaveBeenLastCalledWith({ query: 'cell', project: undefined, limit: 30 })
  );
});

it('lets the keyboard search and dismiss the subject picker', async () => {
  const user = userEvent.setup();

  render(<App />);
  const picker = await screen.findByLabelText('Biology');

  picker.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByLabelText(en.FindSubject)).toHaveFocus());
  await user.clear(screen.getByLabelText(en.FindSubject));
  await user.type(screen.getByLabelText(en.FindSubject), 'Hist');
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(location.pathname + location.search).toBe('/sessions?project=2'));
  screen.getByLabelText('History').focus();
  await user.keyboard('{Enter}{Escape}');
  await waitFor(() => expect(screen.queryByLabelText(en.FindSubject)).not.toBeInTheDocument());
});

it('ignores a subject list fetched before a new subject was created', async () => {
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  let finish: (result: { items: typeof subjects }) => void = () => {};

  api.projects.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await user.click(screen.getByLabelText('Biology'));
  await user.keyboard('{Escape}');
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
  expect(screen.getByRole('button', { name: en.NewSession })).toBeEnabled();
});

it('requests session kinds from the server before limiting search hits', async () => {
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('button', { name: en.SearchFilter }));
  await user.click(await screen.findByRole('menuitem', { name: en.Sessions }));
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

it('uses the sidebar body for pickable sessions and keeps section links in the footer', async () => {
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  const session = await screen.findByRole('link', { name: 'Cell division' });

  expect(session.closest('nav')).toHaveAttribute('aria-label', en.Sessions);
  expect(session).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('link', { name: 'Roman Republic' })).not.toBeInTheDocument();
  const flashcards = screen.getByRole('link', { name: en.Practice });

  expect(flashcards.closest('nav')).toHaveClass('study-sidebar-footer');
  expect(screen.getByRole('link', { name: en.Settings }).parentElement).toHaveClass(
    'study-sidebar-footer-trailing'
  );
  await user.click(flashcards);
  await waitFor(() => expect(location.pathname + location.search).toBe('/practice?project=1'));
  await user.click(screen.getByRole('link', { name: en.Sessions }));
  await user.click(await screen.findByRole('link', { name: 'Cell division' }));
  await waitFor(() =>
    expect(location.pathname + location.search).toBe('/sessions?project=1&id=42')
  );
});

it('mixes sources and diagrams in Library while keeping Sessions separate', async () => {
  api.sources.mockResolvedValue({
    items: [
      { id: 10n, name: 'Cell slides.pdf', projectId: 1n, createdAt: 0n },
      { id: 11n, name: 'History slides.pdf', projectId: 2n, createdAt: 0n }
    ]
  });
  api.materials.mockResolvedValue({
    items: [
      { id: 10n, title: 'Cell map', project_id: 1n, kind: 'diagram', updated_at: 0n },
      { id: 20n, title: 'Cell cards', project_id: 1n, kind: 'flashcards', updated_at: 0n }
    ],
    nextCursor: null
  });
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('link', { name: en.SidebarLibrary }));
  await screen.findByRole('link', { name: 'Cell slides.pdf' });
  expect(screen.getByRole('link', { name: 'Cell map' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Cell division' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'History slides.pdf' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Cell cards' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Cell map' }));
  await waitFor(() =>
    expect(location.pathname + location.search).toBe('/diagrams?project=1&material=10')
  );
  expect(screen.getByRole('link', { name: 'Cell map' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Cell slides.pdf' })).not.toHaveAttribute('aria-current');
});

it('lists flashcards and quizzes together and follows material pagination', async () => {
  api.materials.mockImplementation(({ cursor }) =>
    Promise.resolve(
      cursor
        ? {
            items: [{ id: 22n, title: 'Cell quiz', project_id: 1n, kind: 'quiz', updated_at: 0n }],
            nextCursor: null
          }
        : {
            items: [
              { id: 21n, title: 'Cell cards', project_id: 1n, kind: 'flashcards', updated_at: 0n }
            ],
            nextCursor: 21n
          }
    )
  );
  const user = userEvent.setup();

  render(<App />);
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
    expect(location.pathname + location.search).toBe('/flashcards?project=1&material=21')
  );
});

it('loads later project and session pages', async () => {
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
                projectId: 1n,
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
  render(<App />);
  expect(await screen.findByRole('link', { name: 'Later session' })).toBeInTheDocument();
  const user = userEvent.setup();

  await user.click(await screen.findByLabelText('Biology'));
  expect(await screen.findByRole('option', { name: 'History' })).toBeInTheDocument();
});

it('loads later source pages in the library', async () => {
  api.sources.mockImplementation(({ before }) =>
    Promise.resolve(
      before
        ? { items: [{ id: 11n, name: 'Later file', projectId: 1n, createdAt: 0n }], next: null }
        : { items: [], next: 10n }
    )
  );
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('link', { name: en.SidebarLibrary }));
  expect(await screen.findByRole('link', { name: 'Later file' })).toBeInTheDocument();
});

it.each([
  ['diagram', 'Diagrams'],
  ['flashcards', 'Flashcards'],
  ['quiz', 'Practice']
])('opens a %s search result on its own page', async (materialKind, page) => {
  history.replaceState(null, '', '/settings?project=1');
  api.search.mockResolvedValue({
    semantic: false,
    hits: [
      {
        kind: 'material',
        title: 'Cell study',
        at: 0n,
        target: { type: 'material', projectId: 1n, materialId: 8n, versionId: 9n, materialKind }
      }
    ]
  });
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.type(screen.getByRole('searchbox'), 'cell');
  await user.click(await screen.findByRole('link', { name: /Cell study/ }));
  await waitFor(() =>
    expect(location.pathname + location.search).toBe(`/${page.toLowerCase()}?project=1&material=8`)
  );
});

it('preserves projects loaded while project creation is in flight', async () => {
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

  render(<App />);
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

it('keeps session lists and subject search available on Pipelines', async () => {
  history.replaceState(null, '', '/pipelines?project=1');
  const user = userEvent.setup();

  render(<App />);
  await screen.findByRole('link', { name: 'Cell division' });
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

it('reuses library data when navigating between material pages', async () => {
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('link', { name: en.SidebarLibrary }));
  await waitFor(() => expect(api.sources).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('link', { name: en.Practice }));
  await waitFor(() => expect(location.pathname + location.search).toBe('/practice?project=1'));
  await user.click(screen.getByRole('link', { name: en.SidebarLibrary }));
  await waitFor(() => expect(location.pathname + location.search).toBe('/media-list?project=1'));
  expect(api.sources).toHaveBeenCalledOnce();
});

it('retries route loading after a library request fails', async () => {
  api.sources.mockRejectedValue(new Error('offline'));
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('link', { name: en.SidebarLibrary }));
  const main = screen.getByRole('main');
  const retry = await within(main).findByRole('button', { name: en.StudyLoadError });

  api.sources.mockResolvedValue({ items: [], next: null });
  await user.click(retry);
  await waitFor(() =>
    expect(within(main).queryByRole('button', { name: en.StudyLoadError })).not.toBeInTheDocument()
  );
});

it('reloads library data from the selected project search dependency', async () => {
  api.materials.mockImplementation(({ projectId }) =>
    Promise.resolve({
      items: [
        {
          id: projectId,
          project_id: projectId,
          kind: 'diagram',
          title: projectId === 1n ? 'Biology map' : 'History map',
          updated_at: 0n
        }
      ],
      nextCursor: null
    })
  );
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('link', { name: en.SidebarLibrary }));
  await screen.findByRole('link', { name: 'Biology map' });
  await user.click(screen.getByLabelText('Biology'));
  await user.click(await screen.findByRole('option', { name: 'History' }));
  await screen.findByRole('link', { name: 'History map' });
  expect(screen.queryByRole('link', { name: 'Biology map' })).not.toBeInTheDocument();
});

it('refreshes an initial session request after a session is created', async () => {
  let finish!: (value: { items: [] }) => void;

  api.sessions.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  api.sessions.mockResolvedValue({
    items: [
      {
        id: 7n,
        projectId: 1n,
        title: 'Created session',
        titleSource: 'user',
        createdAt: 0n,
        updatedAt: 0n
      }
    ]
  });
  await user.click(screen.getByRole('button', { name: en.NewSession }));
  await act(async () => {
    finish({ items: [] });
  });
  expect(await screen.findByRole('link', { name: 'Created session' })).toBeInTheDocument();
});
