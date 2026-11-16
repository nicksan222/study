import {
  materialSummarySchema,
  automaticProjectIcon,
  defaultWorkspacePreferences
} from '@study/contracts';
import { configureRpcTransport } from '@study/contracts/react';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Option, Schema } from 'effect';

import type * as __StudyMockType1 from '#client/app/app.tsx';
import type * as __StudyMockType0 from '#client/features/note-workspace/start.tsx';

function createApi(mock: test.Mock) {
  return {
    projects: mock.fn(),
    notes: mock.fn(),
    note: mock.fn(),
    sources: mock.fn(),
    materials: mock.fn(),
    pages: mock.fn(),
    document: mock.fn(),
    search: mock.fn(),
    createProject: mock.fn(),
    createNote: mock.fn()
  };
}

let api: ReturnType<typeof createApi>;

let NoteStart: typeof __StudyMockType0.NoteStart;

let App: typeof __StudyMockType1.App;

test.unit.beforeEach(async ({ mock }) => {
  api = createApi(mock);
  mock('#client/features/note-workspace/workspace.tsx', () => ({
    NoteWorkspace: ({ id }: { id?: bigint }) => (id ? null : <NoteStart />)
  }));
  mock('#client/features/pages/reader-page.tsx', () => ({ PageReaderPage: () => null }));
  const __studyMockModule0 = await import('#client/features/note-workspace/start.tsx');

  NoteStart = __studyMockModule0.NoteStart;
  const __studyMockModule1 = await import('../app');

  App = __studyMockModule1.App;
});

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

function sidebarTransport({ rpcTestTransport }: Pick<test.unit.Context, 'rpcTestTransport'>) {
  let created: (typeof subjects)[number] | undefined;
  const note = (value: { id: bigint; projectIds?: bigint[] }) => ({
    title: 'Note',
    titleSource: 'user',
    archivedAt: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...value,
    projectIds: value.projectIds ?? []
  });

  const foundation = async (tag: string) => {
    if (tag === 'system.health')
      return { protocolVersion: 1, workersRunning: true, testMode: false };

    if (tag === 'settings.appSettings')
      return { language: 1, appearance: 3, zoomPercent: 100, onboarded: true };

    if (tag === 'settings.workspacePreferences') return defaultWorkspacePreferences;

    if (tag === 'settings.sidebarSettings') return { settledPageThreshold: 1 };

    if (tag === 'notes.noteSummaries') return { items: [] };

    return undefined;
  };

  const projectSnapshot = async (tag: string, input: unknown) => {
    if (tag === 'projects.projects') {
      const page = await api.projects(input);

      return {
        ...page,
        next: page.next ?? null,
        items: page.items.map((item: object) => ({ icon: automaticProjectIcon, ...item }))
      };
    }

    if (tag === 'projects.createProject') {
      created = await api.createProject(input);

      return { icon: automaticProjectIcon, ...created };
    }

    if (tag === 'projects.findProject') {
      const { id } = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.BigInt }))(input);
      const project = [...subjects, ...(created ? [created] : [])].find(
        (project) => project.id === id
      );

      return project ? Option.some({ ...project, icon: automaticProjectIcon }) : Option.none();
    }

    return undefined;
  };

  const noteSnapshot = async (tag: string, input: unknown) => {
    if (tag === 'notes.notes') {
      const page = await api.notes(input);

      return { ...page, next: page.next ?? null };
    }

    if (tag === 'notes.note') return note(await api.note(input));

    if (tag === 'notes.createUntitledNote') return note(await api.createNote(input));

    return undefined;
  };

  return rpcTestTransport(async (tag, input) => {
    const base = await foundation(tag);

    if (base !== undefined) return base;

    const project = await projectSnapshot(tag, input);

    if (project !== undefined) return project;

    const noteResult = await noteSnapshot(tag, input);

    if (noteResult !== undefined) return noteResult;

    if (tag === 'sources.sources')
      return { next: null, nextCursor: null, ...(await api.sources(input)) };

    if (tag === 'materials.materials') {
      const page = await api.materials(input);

      return { ...page, items: page.items.map(summary) };
    }

    if (tag === 'pages.pages') return api.pages(input);

    if (tag === 'pages.page')
      return {
        title: 'Cell notes',
        description: null,
        createdAt: 0n,
        updatedAt: 0n,
        archivedAt: null,
        headVersionId: null,
        version: null,
        ...(await api.document(input))
      };

    if (tag === 'system.search') return api.search(input);

    throw new Error(tag);
  });
}

const en = catalogs.english;

async function renderWithNavigation({
  render,
  screen,
  userEvent,
  rpcTestTransport
}: Pick<test.unit.Context, 'render' | 'screen' | 'userEvent' | 'rpcTestTransport'>) {
  const fixture = sidebarTransport({ rpcTestTransport });

  configureRpcTransport(fixture.transport);
  render(<App transport={fixture.transport} />);
  const toggle = await screen.findByRole('button', { name: en.ToggleSidebar });

  if (toggle.getAttribute('aria-expanded') === 'false') {
    await userEvent.setup().click(toggle);
  }
}

const subjects = [
  { id: 1n, name: 'Biology', examOn: null, createdAt: 0n, updatedAt: 0n },
  { id: 2n, name: 'History', examOn: null, createdAt: 0n, updatedAt: 0n }
];

test.unit.beforeEach(() => {
  history.replaceState(null, '', '/projects/1/notes/42');
  api.note.mockReset().mockResolvedValue({ id: 42n, projectIds: [1n] });
  api.projects.mockResolvedValue({ items: subjects });
  api.sources.mockReset().mockResolvedValue({ items: [] });
  api.materials.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  api.pages.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  api.document.mockReset().mockResolvedValue({ id: 10n, projectIds: [1n] });
  api.notes.mockResolvedValue({
    items: [
      {
        id: 42n,
        projectIds: [1n],
        title: 'Cell division',
        titleSource: 'user',
        archivedAt: null,
        createdAt: 0n,
        updatedAt: 0n
      },
      {
        id: 43n,
        projectIds: [2n],
        title: 'Roman Republic',
        titleSource: 'user',
        archivedAt: null,
        createdAt: 0n,
        updatedAt: 0n
      }
    ]
  });
  api.search.mockReset().mockResolvedValue({ hits: [] });
  api.createNote.mockReset().mockResolvedValue({ id: 7n });
});

test.unit.stable(
  'switches subjects while keeping the section and clearing the selected item',
  async ({ userEvent, screen, waitFor, expect, render, rpcTestTransport }) => {
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await user.click(await screen.findByLabelText('Biology'));
    await user.click(await screen.findByRole('option', { name: 'History' }));
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/2/notes'));
    expect(await screen.findByLabelText('History')).toBeInTheDocument();
  }
);

test.unit.stable(
  'searches within the selected subject and opens a result',
  async ({ userEvent, screen, expect, waitFor, render, rpcTestTransport }) => {
    api.search.mockResolvedValue({
      hits: [
        {
          kind: 'note',
          title: 'Cell division',
          at: 0n,
          target: { type: 'note', noteId: 9n }
        }
      ]
    });
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByLabelText('Biology');
    await user.type(screen.getByRole('searchbox'), 'cell');
    await user.click(await screen.findByRole('link', { name: /Cell division/ }));
    expect(api.search).toHaveBeenLastCalledWith({
      query: 'cell',
      project: 1n,
      limit: 30,
      kinds: ['note', 'message']
    });
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/1/notes/9'));
  }
);

test.unit.stable(
  'opens one local draft in the selected subject without persisting an empty note',
  async ({ userEvent, screen, within, waitFor, expect, render, rpcTestTransport }) => {
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByLabelText('Biology');
    await user.click(
      within(screen.getByRole('complementary', { name: en.SidebarNavigation })).getByRole(
        'button',
        { name: en.NewNote }
      )
    );
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/1/notes'));
    expect(api.createNote).not.toHaveBeenCalled();
    expect(await screen.findByRole('textbox', { name: en.NoteCompose })).toHaveValue('');
    expect(screen.getByRole('button', { name: en.NoteSaveNote })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: en.NoteCompose }), 'Unsent biology notes');
    const sidebar = within(screen.getByRole('complementary', { name: en.SidebarNavigation }));
    const draft = await sidebar.findByRole('link', { name: /Unsent biology notes/ });

    expect(draft.closest('details')).toBeNull();
    expect(draft.closest('.study-note-entry')).toBe(
      draft.closest('.study-note-groups')?.firstElementChild
    );
  }
);

test.unit.stable(
  'does not search another subject when the URL subject is missing',
  async ({ userEvent, screen, expect, within, waitFor, render, rpcTestTransport }) => {
    history.replaceState(null, '', '/projects/99/notes');
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByText(en.SubjectNotFound);
    await user.type(screen.getByRole('searchbox'), 'cell');
    expect(api.search).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole('complementary', { name: en.SidebarNavigation })).getByRole(
        'button',
        {
          name: en.NewNote
        }
      )
    );
    await waitFor(() => expect(location.pathname + location.search).toBe('/notes'));
    expect(api.createNote).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'opens search from the collapsed rail with the keyboard shortcut',
  async ({ userEvent, screen, waitFor, expect, render, rpcTestTransport }) => {
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByLabelText('Biology');
    await user.click(screen.getByRole('button', { name: en.ToggleSidebar }));
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveFocus());
  }
);

test.unit.stable(
  'creates a subject from the toolbar and selects it',
  async ({ userEvent, screen, expect, waitFor, render, rpcTestTransport }) => {
    api.createProject.mockResolvedValue({ ...subjects[0], id: 3n, name: 'Physics' });
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByLabelText('Biology');
    await user.click(screen.getByRole('button', { name: en.NewProject }));
    await user.type(screen.getByRole('textbox', { name: en.ProjectName }), 'Physics');
    await user.click(screen.getByRole('button', { name: en.CreateProject }));
    expect(api.createProject).toHaveBeenCalledWith({ name: 'Physics' });
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/3/notes'));
  }
);

test.unit.stable(
  'searches note content across subjects when no subject is selected',
  async ({ userEvent, screen, waitFor, expect, render, rpcTestTransport }) => {
    history.replaceState(null, '', '/notes');
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByRole('combobox', { name: en.ChooseProject });
    await user.type(screen.getByRole('searchbox'), 'cell');
    await waitFor(() =>
      expect(api.search).toHaveBeenLastCalledWith({
        query: 'cell',
        project: undefined,
        limit: 30,
        kinds: ['note', 'message']
      })
    );
  }
);

test.unit.stable(
  'lets the keyboard search and dismiss the subject picker',
  async ({ userEvent, screen, waitFor, expect, render, rpcTestTransport }) => {
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    const picker = await screen.findByLabelText('Biology');

    picker.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByLabelText(en.FindSubject)).toHaveFocus());
    await user.clear(screen.getByLabelText(en.FindSubject));
    await user.type(screen.getByLabelText(en.FindSubject), 'Hist');
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/2/notes'));
    screen.getByLabelText('History').focus();
    await user.keyboard('{Enter}{Escape}');
    await waitFor(() => expect(screen.queryByLabelText(en.FindSubject)).not.toBeInTheDocument());
  }
);

test.unit.stable(
  'ignores a subject list fetched before a new subject was created',
  async ({ userEvent, screen, waitFor, expect, act, within, render, rpcTestTransport }) => {
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
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
      within(screen.getByRole('complementary', { name: en.SidebarNavigation })).getByRole(
        'button',
        {
          name: en.NewNote
        }
      )
    ).toBeEnabled();
  }
);

test.unit.stable(
  'searches note content without a sidebar filter control',
  async ({ userEvent, screen, expect, waitFor, render, rpcTestTransport }) => {
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByLabelText('Biology');
    expect(screen.queryByRole('button', { name: en.SearchFilter })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'cell');
    await waitFor(() =>
      expect(api.search).toHaveBeenLastCalledWith({
        query: 'cell',
        project: 1n,
        limit: 30,
        kinds: ['note', 'message']
      })
    );
  }
);

test.unit.stable(
  'uses the body for notes and a labeled navigation block above settings',
  async ({ userEvent, screen, expect, waitFor, render, rpcTestTransport }) => {
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByLabelText('Biology');
    const note = await screen.findByRole('link', { name: /Cell division/ });

    expect(note.closest('nav')).toHaveAttribute('aria-label', en.Notes);
    expect(note).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: /Roman Republic/ })).not.toBeInTheDocument();
    const flashcards = screen.getByRole('link', {
      name: new RegExp(`^${en.Practice}(?: \\d+)?$`)
    });

    expect(flashcards.closest('nav')).toHaveClass('study-sidebar-navigation');
    expect(flashcards).toHaveTextContent(en.Practice);
    expect(screen.getByRole('button', { name: en.Settings })).toHaveTextContent(en.Settings);
    expect(screen.getByRole('button', { name: en.Settings }).closest('nav')).toHaveClass(
      'study-sidebar-footer'
    );
    await user.click(flashcards);
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/1/practice'));
    await user.click(screen.getByRole('link', { name: new RegExp(`^${en.Notes}(?: \\d+)?$`) }));
    await user.click(await screen.findByRole('link', { name: /Cell division/ }));
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/1/notes/42'));
  }
);

test.unit.stable(
  'lists flashcards and quizzes together and follows material pagination',
  async ({ userEvent, screen, expect, waitFor, render, rpcTestTransport }) => {
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

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByLabelText('Biology');
    await user.click(screen.getByRole('link', { name: new RegExp(`^${en.Practice}(?: \\d+)?$`) }));
    await screen.findByRole('link', { name: /Cell cards/ });
    await user.click(screen.getByRole('button', { name: en.LibraryMore }));
    expect(await screen.findByRole('link', { name: /Cell quiz/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Cell division/ })).not.toBeInTheDocument();
    expect(api.materials).toHaveBeenLastCalledWith({
      projectId: 1n,
      cursor: 21n,
      limit: 100,
      archived: false
    });
    await user.click(screen.getByRole('button', { name: en.Back }));
    await user.click(await screen.findByRole('link', { name: /Cell cards/ }));
    await waitFor(() =>
      expect(location.pathname + location.search).toBe('/projects/1/flashcards/21')
    );
  }
);

test.unit.stable(
  'loads later project and note pages',
  async ({ userEvent, screen, expect, render, rpcTestTransport }) => {
    api.projects.mockImplementation(({ before }) =>
      Promise.resolve(
        before ? { items: [subjects[1]], next: null } : { items: [subjects[0]], next: 1n }
      )
    );
    api.notes.mockImplementation(({ before }) =>
      Promise.resolve(
        before
          ? {
              items: [
                {
                  id: 43n,
                  projectIds: [1n],
                  title: 'Later note',
                  titleSource: 'user',
                  archivedAt: null,
                  createdAt: 0n,
                  updatedAt: 0n
                }
              ],
              next: null
            }
          : { items: [], next: { id: 42n, updatedAt: 1n } }
      )
    );
    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await userEvent.click(await screen.findByRole('button', { name: en.LibraryMore }));
    expect(await screen.findByRole('link', { name: /Later note/ })).toBeInTheDocument();
    const user = userEvent.setup();

    const picker = await screen.findByLabelText('Biology');

    if (picker.getAttribute('aria-expanded') !== 'true') await user.click(picker);

    await screen.findByLabelText(en.FindSubject);
    await user.click(screen.getByRole('button', { name: en.LibraryMore }));
    expect(await screen.findByRole('option', { name: 'History' })).toBeInTheDocument();
  }
);

test.unit.stable.for([
  ['flashcards', '/projects/1/flashcards/8'],
  ['quiz', '/projects/1/practice/8']
])(
  'filters the practice list and opens %s in its subject',
  async (
    [kind, destination],
    { userEvent, screen, within, waitFor, expect, render, rpcTestTransport }
  ) => {
    history.replaceState(null, '', '/projects/1/practice');
    api.materials.mockResolvedValue({
      items: [
        {
          id: 8n,
          kind,
          title: 'Cell study',
          projectIds: [1n],
          updated_at: 0n
        }
      ],
      nextCursor: null
    });
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByLabelText('Biology');
    await user.type(screen.getByRole('searchbox'), 'cell');
    await user.click(
      await within(screen.getByRole('complementary')).findByRole('link', { name: /Cell study/ })
    );
    await waitFor(() => expect(location.pathname + location.search).toBe(destination));
    expect(api.search).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'preserves projects loaded while project creation is in flight',
  async ({ userEvent, screen, act, expect, render, rpcTestTransport }) => {
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

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
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
  }
);

test.unit.stable(
  'first send adds a note to the sidebar and permits another lazy note',
  async ({ userEvent, screen, within, waitFor, expect, act, render, rpcTestTransport }) => {
    let finish!: (value: { items: [] }) => void;

    api.notes.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const user = userEvent.setup();

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await screen.findByLabelText('Biology');
    api.notes.mockResolvedValue({
      items: [
        {
          id: 7n,
          projectIds: [1n],
          title: 'Created note',
          titleSource: 'user',
          archivedAt: null,
          createdAt: 0n,
          updatedAt: 0n
        }
      ]
    });
    api.createNote.mockResolvedValue({
      id: 7n,
      projectIds: [1n],
      title: 'Created note',
      titleSource: 'provisional',
      archivedAt: null,
      createdAt: 0n,
      updatedAt: 0n
    });
    await user.click(
      within(screen.getByRole('complementary', { name: en.SidebarNavigation })).getByRole(
        'button',
        {
          name: en.NewNote
        }
      )
    );
    await user.type(await screen.findByRole('textbox', { name: en.NoteCompose }), 'First note');
    await user.click(screen.getByRole('button', { name: en.NoteSaveNote }));
    await waitFor(() => expect(location.pathname).toBe('/projects/1/notes/7'));
    await act(async () => {
      finish({ items: [] });
    });
    expect(await screen.findByRole('link', { name: /Created note/ })).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('complementary', { name: en.SidebarNavigation })).getByRole(
        'button',
        {
          name: en.NewNote
        }
      )
    );
    const input = await screen.findByRole('textbox', { name: en.NoteCompose });

    expect(input).toHaveValue('');
    await user.type(input, 'Second note');
    expect(screen.getByRole('button', { name: en.NoteSaveNote })).toBeEnabled();
    const second = {
      id: 8n,
      projectIds: [1n],
      title: 'Second note',
      titleSource: 'provisional',
      archivedAt: null,
      createdAt: 0n,
      updatedAt: 0n
    };

    api.createNote.mockResolvedValueOnce(second);
    api.notes.mockResolvedValue({ items: [second] });
    await user.click(screen.getByRole('button', { name: en.NoteSaveNote }));
    await waitFor(() => expect(location.pathname).toBe('/projects/1/notes/8'));
    expect(await screen.findByRole('link', { name: /Second note/ })).toBeInTheDocument();
  }
);

test.unit.stable.for(['/notes/42', '/projects/2/notes/42'])(
  'uses the actual note owner for direct and mismatched links: %s',
  async (url, { expect, screen, userEvent, waitFor, render, rpcTestTransport }) => {
    history.replaceState(null, '', url);
    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    expect(await screen.findByLabelText('Biology')).toBeVisible();
    expect(await screen.findByRole('link', { name: /Cell division/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Roman Republic/ })).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole('searchbox'), 'cell');
    await waitFor(() =>
      expect(api.search).toHaveBeenLastCalledWith({
        query: 'cell',
        project: 1n,
        limit: 30,
        kinds: ['note', 'message']
      })
    );
  }
);

test.unit.stable(
  'does not reveal a foreign subject while note ownership is loading',
  async ({ expect, screen, userEvent, render, rpcTestTransport }) => {
    history.replaceState(null, '', '/projects/2/notes/42');
    api.note.mockReturnValue(new Promise(() => {}));
    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    expect(screen.queryByLabelText('History')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Roman Republic/ })).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole('searchbox'), 'rome');
    expect(api.search).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'keeps projectless notes independent of a foreign query parameter',
  async ({ waitFor, expect, screen, render, userEvent, rpcTestTransport }) => {
    history.replaceState(null, '', '/projects/2/notes/42');
    api.note.mockResolvedValue({ id: 42n, projectIds: [] });
    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    await waitFor(() => expect(api.note).toHaveBeenCalled());
    expect(screen.queryByLabelText('History')).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'retries a failed note owner read from the subject picker error',
  async ({ screen, userEvent, expect, render, rpcTestTransport }) => {
    api.note.mockRejectedValue(new Error('offline'));
    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    const retry = await screen.findByRole('button', { name: en.SubjectsLoadError });

    api.note.mockResolvedValue({ id: 42n, projectIds: [1n] });
    await userEvent.setup().click(retry);
    expect(await screen.findByLabelText('Biology')).toBeVisible();
  }
);

test.unit.stable.for(['/pages/10', '/projects/2/pages/10'])(
  'uses route-owned document context and shows only pages in the sidebar: %s',
  async (url, { userEvent, expect, screen, waitFor, render, rpcTestTransport }) => {
    history.replaceState(null, '', url);
    api.pages.mockResolvedValue({
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

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    expect(await screen.findByLabelText('Biology')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Cell division/ })).not.toBeInTheDocument();
    const document = await screen.findByRole('link', { name: /Cell notes/ });

    expect(document).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getByRole('link', { name: new RegExp(`^${en.SourcePage}(?: \\d+)?$`) })
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: /Roman Republic/ })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Biology'));
    await user.click(await screen.findByRole('option', { name: 'History' }));
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/2/pages'));
  }
);

test.unit.stable(
  'opens Pages between Notes and Practice with a pages-only sidebar',
  async ({ userEvent, within, screen, expect, waitFor, render, rpcTestTransport }) => {
    api.pages.mockResolvedValue({
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

    await renderWithNavigation({ render, screen, userEvent, rpcTestTransport });
    const sidebar = within(screen.getByRole('complementary', { name: en.SidebarNavigation }));

    expect(await sidebar.findByRole('link', { name: /Cell division/ })).toBeVisible();
    expect(sidebar.queryByRole('link', { name: /Cell notes/ })).not.toBeInTheDocument();
    const navigation = within(sidebar.getByRole('navigation', { name: en.SidebarNavigation }));

    expect(
      navigation
        .getAllByRole('link')
        .slice(0, 3)
        .map((link) => link.querySelector('.study-sidebar-navigation-label')?.textContent)
    ).toEqual([en.Notes, en.SourcePage, en.Practice]);
    await user.click(
      navigation.getByRole('link', { name: new RegExp(`^${en.SourcePage}(?: \\d+)?$`) })
    );
    await waitFor(() => expect(location.pathname + location.search).toBe('/projects/1/pages'));
    await sidebar.findByRole('link', { name: /Cell notes/ });
    expect(sidebar.queryByRole('link', { name: /Cell division/ })).not.toBeInTheDocument();
    expect(sidebar.queryByText(en.SidebarOpen)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.PagesOverviewTitle, level: 2 })).toBeVisible();
    await user.type(sidebar.getByRole('searchbox'), 'missing');
    expect(await sidebar.findByText(en.SearchNoResults)).toBeVisible();
    await user.clear(sidebar.getByRole('searchbox'));
    await user.click(await sidebar.findByRole('link', { name: /Cell notes/ }));
    await waitFor(() => expect(location.pathname).toBe('/projects/1/pages/10'));
    expect(await sidebar.findByRole('link', { name: /Cell notes/ })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(sidebar.queryByRole('link', { name: /Cell division/ })).not.toBeInTheDocument();
  }
);
