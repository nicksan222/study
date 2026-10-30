import { catalogs } from '@study/localization';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { App } from './app';

const api = vi.hoisted(() => ({
  projects: vi.fn(),
  sessions: vi.fn(),
  sources: vi.fn(),
  materials: vi.fn(),
  search: vi.fn(),
  createProject: vi.fn(),
  createSession: vi.fn()
}));

vi.mock('./study-client', () => ({
  studyClient: {
    projects: { projects: { query: api.projects }, createProject: { mutate: api.createProject } },
    sources: { sources: { query: api.sources } },
    materials: { list: { query: api.materials } },
    system: { search: { query: api.search } },
    conversations: {
      allSessions: { query: api.sessions },
      createUntitledSession: { mutate: api.createSession }
    }
  }
}));

const en = catalogs.english;

const subjects = [
  { id: 1n, name: 'Biology', examOn: null, createdAt: 0n, updatedAt: 0n },
  { id: 2n, name: 'History', examOn: null, createdAt: 0n, updatedAt: 0n }
];

beforeEach(() => {
  history.replaceState(null, '', '/#/Sessions?project=1&id=42');
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
  await waitFor(() => expect(location.hash).toBe('#/Sessions?project=2'));
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
  expect(api.search).toHaveBeenLastCalledWith(
    { query: 'cell', project: 1n, limit: 30, kinds: ['session', 'message'] },
    expect.anything()
  );
  await waitFor(() => expect(location.hash).toBe('#/Sessions?project=1&id=9'));
});

it('creates a real session in the selected subject', async () => {
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.click(screen.getByRole('button', { name: en.NewSession }));
  expect(api.createSession).toHaveBeenCalledWith({ project: 1n, title: en.NewSession });
  await waitFor(() => expect(location.hash).toBe('#/Sessions?project=1&id=7'));
});

it('does not search another subject when the URL subject is missing', async () => {
  history.replaceState(null, '', '/#/Sessions?project=99');
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
  await waitFor(() => expect(location.hash).toBe('#/Sessions?project=3'));
});

it('searches globally on Settings while retaining the subject for navigation', async () => {
  history.replaceState(null, '', '/#/Settings?project=1');
  const user = userEvent.setup();

  render(<App />);
  await screen.findByLabelText('Biology');
  await user.type(screen.getByRole('searchbox'), 'cell');
  await waitFor(() =>
    expect(api.search).toHaveBeenLastCalledWith(
      { query: 'cell', project: undefined, limit: 30 },
      expect.anything()
    )
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
  await waitFor(() => expect(location.hash).toBe('#/Sessions?project=2'));
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
    expect(api.search).toHaveBeenLastCalledWith(
      { query: 'cell', project: 1n, limit: 30, kinds: ['session', 'message'] },
      expect.anything()
    )
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
  await waitFor(() => expect(location.hash).toBe('#/Practice?project=1'));
  await user.click(screen.getByRole('link', { name: en.Sessions }));
  await user.click(await screen.findByRole('link', { name: 'Cell division' }));
  await waitFor(() => expect(location.hash).toBe('#/Sessions?project=1&id=42'));
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
  await waitFor(() => expect(location.hash).toBe('#/Diagrams?project=1&material=10'));
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
  expect(api.materials).toHaveBeenLastCalledWith(
    { projectId: 1n, cursor: 21n, take: 100, archived: false },
    expect.anything()
  );
  await user.click(screen.getByRole('link', { name: 'Cell cards' }));
  await waitFor(() => expect(location.hash).toBe('#/Flashcards?project=1&material=21'));
});
