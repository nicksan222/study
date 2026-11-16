import { StudyError, materialSummarySchema, noteSchema, projectSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type * as UiModule from '@study/ui';

let toastManager: typeof __MockType0.toastManager;

import type * as __MockType0 from '@study/ui';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  stringifySearchWith,
  RouterProvider
} from '@tanstack/react-router';
import { Effect, Schema } from 'effect';

import type * as __MockType1 from '#client/lib/i18n.tsx';

import type * as __MockType2 from './collections-page';

let LanguageProvider: typeof __MockType1.LanguageProvider;

let CollectionsPage: typeof __MockType2.CollectionsPage;

let rpc: ReturnType<typeof createMockState>['rpc'];

const t = catalogs.english;

const project = Schema.decodeUnknownSync(projectSchema)({
  id: 9007199254740993n,
  name: 'Biology',
  examOn: null,
  createdAt: 1n,
  updatedAt: 1n
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

function mount({
  rpcHandlersTransport,
  render
}: Pick<test.Context, 'rpcHandlersTransport' | 'render'>) {
  const harness = rpcHandlersTransport(rpc);
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/projects', component: CollectionsPage }),
      createRoute({ getParentRoute: () => root, path: '/home', component: () => <p>Away</p> })
    ]),
    parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
    stringifySearch: stringifySearchWith(String),
    history: createMemoryHistory({ initialEntries: ['/projects'] })
  });
  const view = render(
    <harness.wrapper>
      <LanguageProvider locale="english">
        <RouterProvider router={router} />
      </LanguageProvider>
    </harness.wrapper>
  );

  return { ...view, notify: harness.notify, router };
}

async function remount(
  { act, screen }: Pick<test.Context, 'act' | 'screen'>,
  router: ReturnType<typeof mount>['router']
) {
  await act(async () => {
    await router.navigate({ to: '/home' });
  });
  await screen.findByText('Away');
  await act(async () => {
    await router.navigate({ to: '/projects' });
  });
  await screen.findByRole('button', { name: t['collections.create'] });
}

function createName({ screen }: Pick<test.Context, 'screen'>) {
  return screen.getAllByRole('textbox', { name: t['collections.name'] })[0]!;
}

function detail({ within, screen }: Pick<test.Context, 'within' | 'screen'>) {
  return within(screen.getByRole('region', { name: 'Biology' }));
}

async function selectProject({
  act,
  fireEvent,
  screen
}: Pick<test.Context, 'act' | 'fireEvent' | 'screen'>) {
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Biology' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await screen.findByRole('region', { name: 'Biology' });
}

function createMockState(mock: test.Mock) {
  return {
    rpc: (() => ({
      'projects.projects': mock.fn<StudyClient['projects.projects']>(),
      'projects.project': mock.fn<StudyClient['projects.project']>(),
      'projects.createProject': mock.fn<StudyClient['projects.createProject']>(),
      'projects.deleteProject': mock.fn<StudyClient['projects.deleteProject']>(),
      'projects.renameProject': mock.fn<StudyClient['projects.renameProject']>(),
      'projects.addMaterial': mock.fn<StudyClient['projects.addMaterial']>(),
      'projects.removeMaterial': mock.fn<StudyClient['projects.removeMaterial']>(),
      'projects.addNote': mock.fn<StudyClient['projects.addNote']>(),
      'projects.removeNote': mock.fn<StudyClient['projects.removeNote']>(),
      'materials.materials': mock.fn<StudyClient['materials.materials']>(),
      'notes.notes': mock.fn<StudyClient['notes.notes']>()
    }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  rpc = __mockState.rpc;

  mock('@study/ui', async (load) => {
    const actual = await load<typeof UiModule>();

    return { ...actual, toastManager: { ...actual.toastManager, add: mock.fn() } };
  });
  const __mockModule0 = await import('@study/ui');

  toastManager = __mockModule0.toastManager;
  const __mockModule1 = await import('#client/lib/i18n.tsx');

  LanguageProvider = __mockModule1.LanguageProvider;
  const __mockModule2 = await import('./collections-page');

  CollectionsPage = __mockModule2.CollectionsPage;
});

test.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  rpc['projects.projects'].mockReturnValue(Effect.succeed({ items: [project], next: null }));
  rpc['projects.project'].mockReturnValue(Effect.succeed(project));
  rpc['materials.materials'].mockReturnValue(Effect.succeed({ items: [], nextCursor: null }));
  rpc['notes.notes'].mockReturnValue(Effect.succeed({ items: [], next: null }));
});

test.stable(
  'excludes duplicate create across a route remount and preserves a newer draft after the late receipt',
  async ({ screen, act, fireEvent, expect, waitFor, rpcHandlersTransport, render }) => {
    const response = deferred<typeof project>();

    rpc['projects.createProject'].mockReturnValue(Effect.promise(() => response.promise));
    const { router } = mount({ rpcHandlersTransport, render });

    await screen.findByRole('button', { name: 'Biology' });
    await act(async () => {
      fireEvent.change(createName({ screen }), { target: { value: 'Submitted' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t['collections.create'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText(t['collections.creating']);
    expect(screen.queryByText(t['collections.uncertain'])).toBeNull();
    await remount({ act, screen }, router);
    await act(async () => {
      fireEvent.change(createName({ screen }), { target: { value: 'New unsent draft' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('button', { name: t['collections.create'] })).toBeDisabled();
    expect(screen.queryByRole('button', { name: t['collections.reviewed'] })).toBeNull();
    await act(async () => {
      fireEvent.submit(createName({ screen }).closest('form')!);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(rpc['projects.createProject']).toHaveBeenCalledExactlyOnceWith({ name: 'Submitted' });
    await act(async () => {
      response.resolve(project);
      await response.promise;
    });
    await screen.findByText(t['collections.created']);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t['collections.create'] })).toBeEnabled()
    );
    expect(createName({ screen })).toHaveValue('New unsent draft');
    expect(screen.queryByText(String(project.id))).toBeNull();
    await remount({ act, screen }, router);
    expect(createName({ screen })).toHaveValue('New unsent draft');
  }
);

test.stable(
  'requires a fresh list review after settled ambiguous creation without replaying the write',
  async ({ screen, act, fireEvent, waitFor, expect, rpcHandlersTransport, render }) => {
    rpc['projects.createProject'].mockReturnValue(
      Effect.fail(new StudyError('internal', 'response lost'))
    );
    const { router } = mount({ rpcHandlersTransport, render });

    await screen.findByRole('button', { name: 'Biology' });
    await act(async () => {
      fireEvent.change(createName({ screen }), { target: { value: 'Submitted' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t['collections.create'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText(t['collections.uncertain']);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t['collections.retry'] })).toBeEnabled()
    );
    await remount({ act, screen }, router);
    expect(screen.getByRole('button', { name: t['collections.reviewed'] })).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t['collections.retry'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t['collections.reviewed'] })).toBeEnabled()
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t['collections.reviewed'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t['collections.create'] })).toBeEnabled()
    );
    expect(createName({ screen })).toHaveValue('Submitted');
    expect(rpc['projects.createProject']).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'serializes rename through remount and retains edits made after submission',
  async ({ act, fireEvent, waitFor, expect, screen, rpcHandlersTransport, render, within }) => {
    const response = deferred<boolean>();

    rpc['projects.renameProject'].mockReturnValue(Effect.promise(() => response.promise));
    const { router } = mount({ rpcHandlersTransport, render });

    await selectProject({ act, fireEvent, screen });
    await act(async () => {
      fireEvent.change(detail({ within, screen }).getByRole('textbox'), {
        target: { value: 'Submitted rename' }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(
        detail({ within, screen }).getByRole('button', { name: t['collections.rename'] })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(rpc['projects.renameProject']).toHaveBeenCalledTimes(1));
    await remount({ act, screen }, router);
    await screen.findByRole('region', { name: 'Biology' });
    await act(async () => {
      fireEvent.change(detail({ within, screen }).getByRole('textbox'), {
        target: { value: 'New rename draft' }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      detail({ within, screen }).getByRole('button', { name: t['collections.rename'] })
    ).toBeDisabled();
    await act(async () => {
      fireEvent.submit(detail({ within, screen }).getByRole('textbox').closest('form')!);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      response.resolve(true);
      await response.promise;
    });
    await waitFor(() =>
      expect(
        detail({ within, screen }).getByRole('button', { name: t['collections.rename'] })
      ).toBeEnabled()
    );
    await remount({ act, screen }, router);
    expect(await screen.findByRole('region', { name: 'Biology' })).toBeInTheDocument();
    expect(detail({ within, screen }).getByRole('textbox')).toHaveValue('New rename draft');
    expect(rpc['projects.renameProject']).toHaveBeenCalledExactlyOnceWith({
      id: project.id,
      name: 'Submitted rename'
    });
  }
);

test.stable(
  'reads the selected identity exactly when it is absent from the reloaded catalog and shows canonical rename data',
  async ({ screen, expect, within, rpcHandlersTransport, render, act, fireEvent }) => {
    const { router } = mount({ rpcHandlersTransport, render });

    await selectProject({ act, fireEvent, screen });
    rpc['projects.projects'].mockReturnValue(Effect.succeed({ items: [], next: project.id }));
    rpc['projects.project'].mockReturnValue(Effect.succeed({ ...project, name: 'Canonical name' }));
    await remount({ act, screen }, router);
    await screen.findByRole('region', { name: 'Canonical name' });
    expect(screen.queryByRole('button', { name: 'Biology' })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Canonical name' })).getByRole('textbox')
    ).toHaveValue('Canonical name');
    expect(rpc['projects.project']).toHaveBeenLastCalledWith({ id: project.id });
  }
);

test.stable(
  'treats a false rename receipt as missing and preserves its unsent name',
  async ({ act, fireEvent, screen, waitFor, expect, rpcHandlersTransport, render, within }) => {
    rpc['projects.renameProject'].mockReturnValue(Effect.succeed(false));
    const { router } = mount({ rpcHandlersTransport, render });

    await selectProject({ act, fireEvent, screen });
    await act(async () => {
      fireEvent.change(detail({ within, screen }).getByRole('textbox'), {
        target: { value: 'Keep this name' }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(
        detail({ within, screen }).getByRole('button', { name: t['collections.rename'] })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText(t['collections.missing']);
    await waitFor(() =>
      expect(
        detail({ within, screen }).getByRole('button', { name: t['collections.rename'] })
      ).toBeEnabled()
    );
    await remount({ act, screen }, router);
    await screen.findByRole('region', { name: 'Biology' });
    expect(detail({ within, screen }).getByRole('textbox')).toHaveValue('Keep this name');
  }
);

test.stable(
  'hides stale selected controls and the accepted receipt when the exact project becomes missing',
  async ({ screen, act, fireEvent, waitFor, expect, rpcHandlersTransport, render }) => {
    rpc['projects.createProject'].mockReturnValue(Effect.succeed(project));
    mount({ rpcHandlersTransport, render });
    await screen.findByRole('button', { name: 'Biology' });
    await act(async () => {
      fireEvent.change(createName({ screen }), { target: { value: 'Biology' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t['collections.create'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText(t['collections.created']);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: t['collections.retry'] })[0]).toBeEnabled()
    );
    rpc['projects.project'].mockReturnValue(Effect.fail(new StudyError('not_found', 'gone')));
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: t['collections.retry'] })[0]!);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText(t['collections.missing']);
    expect(screen.queryByRole('region', { name: 'Biology' })).toBeNull();
    await waitFor(() => expect(screen.queryByText(t['collections.created'])).toBeNull());
  }
);

test.stable.for(['materials', 'notes'] as const)(
  'reconciles an ambiguous %s membership response and supports explicit refresh without replay',
  async (
    kind,
    { screen, act, fireEvent, waitFor, expect, within, rpcHandlersTransport, render }
  ) => {
    let member = true;
    const material = Schema.decodeUnknownSync(materialSummarySchema)({
      id: 7n,
      projectIds: [project.id],
      kind: 'flashcards',
      title: 'Reading',
      created_at: 1n,
      updated_at: 1n,
      archived_at: null,
      version: {
        id: 8n,
        material_id: 7n,
        kind: 'flashcards',
        number: 1n,
        status: 'published',
        operation: 'original',
        creator: 'user',
        instruction: null,
        language: null,
        created_at: 1n,
        published_at: 1n
      },
      latestPublishedVersion: null,
      latestDraftVersion: null
    });
    const note = Schema.decodeUnknownSync(noteSchema)({
      id: 9n,
      projectIds: [project.id],
      title: 'Discussion',
      titleSource: 'user',
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 1n
    });

    rpc['materials.materials'].mockImplementation(() =>
      Effect.succeed({ items: member ? [material] : [], nextCursor: null })
    );
    rpc['notes.notes'].mockImplementation(() =>
      Effect.succeed({ items: member ? [note] : [], next: null })
    );
    const remove =
      kind === 'materials' ? rpc['projects.removeMaterial'] : rpc['projects.removeNote'];
    const failed = () =>
      Effect.sync(() => {
        member = false;
      }).pipe(
        Effect.flatMap(() => Effect.fail(new StudyError('internal', 'lost response after commit')))
      );

    rpc['projects.removeMaterial'].mockImplementation(failed);
    rpc['projects.removeNote'].mockImplementation(failed);
    const { notify } = mount({ rpcHandlersTransport, render });

    await selectProject({ act, fireEvent, screen });
    const title = kind === 'materials' ? 'Reading' : 'Discussion';
    const button = await screen.findByRole('button', {
      name: `${t['collections.detach']}: ${title}`
    });
    const section = button.closest('section')!;

    await act(async () => {
      fireEvent.click(button);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText(t['collections.mutationError']);
    await act(() => notify());
    await waitFor(() => expect(within(section).queryByText(title)).toBeNull());
    await waitFor(() =>
      expect(within(section).getByRole('button', { name: t['collections.retry'] })).toBeEnabled()
    );
    expect(within(section).getByText(t['collections.emptyMembers'])).toBeInTheDocument();
    member = true;
    await act(async () => {
      fireEvent.click(within(section).getByRole('button', { name: t['collections.retry'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await within(section).findByText(title);
    expect(screen.getByText(t['collections.mutationError'])).toBeInTheDocument();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(
      kind === 'materials'
        ? { projectId: project.id, materialId: material.id }
        : { projectId: project.id, noteId: note.id }
    );
  }
);

test.stable(
  'provides contextual empty guidance for catalog, members and picker',
  async ({ screen, act, waitFor, expect, fireEvent, rpcHandlersTransport, render }) => {
    rpc['projects.projects'].mockReturnValueOnce(Effect.succeed({ items: [], next: null }));
    const { notify } = mount({ rpcHandlersTransport, render });

    await screen.findByText(t['collections.emptyCatalog']);
    await act(async () => {
      await notify();
    });
    await selectProject({ act, fireEvent, screen });
    await waitFor(() => expect(screen.getAllByText(t['collections.emptyMembers'])).toHaveLength(2));
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: t['collections.picker'] })[0]!);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText(t['collections.emptyPicker']);
  }
);

test.stable(
  'keeps typed invalid-input rejection editable without an ambiguous-create acknowledgement',
  async ({ screen, act, fireEvent, waitFor, expect, rpcHandlersTransport, render }) => {
    rpc['projects.createProject'].mockReturnValue(
      Effect.fail(new StudyError('invalid_input', 'rejected'))
    );
    mount({ rpcHandlersTransport, render });
    await screen.findByRole('button', { name: 'Biology' });
    await act(async () => {
      fireEvent.change(createName({ screen }), { target: { value: 'Rejected draft' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t['collections.create'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText(t['collections.invalidName']);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t['collections.create'] })).toBeEnabled()
    );
    expect(createName({ screen })).toHaveValue('Rejected draft');
    expect(screen.queryByText(t['collections.uncertain'])).toBeNull();
    expect(screen.queryByRole('button', { name: t['collections.reviewed'] })).toBeNull();
    expect(rpc['projects.createProject']).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'uses complete projectIds in the picker and reconciles a lost add response without replay',
  async ({ screen, act, fireEvent, expect, waitFor, within, rpcHandlersTransport, render }) => {
    let attached = false;
    const note = Schema.decodeUnknownSync(noteSchema)({
      id: 9n,
      projectIds: [],
      title: 'Available discussion',
      titleSource: 'user',
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 1n
    });
    const existing = {
      ...note,
      id: Schema.decodeUnknownSync(noteSchema)({ ...note, id: 10n }).id,
      title: 'Already attached',
      projectIds: [project.id]
    };

    rpc['notes.notes'].mockImplementation(({ project: filter }) =>
      Effect.succeed({
        items: filter
          ? attached
            ? [{ ...note, projectIds: [project.id] }]
            : []
          : [{ ...note, projectIds: attached ? [project.id] : [] }, existing],
        next: null
      })
    );
    rpc['projects.addNote'].mockImplementation(() =>
      Effect.sync(() => {
        attached = true;
      }).pipe(Effect.flatMap(() => Effect.fail(new StudyError('internal', 'lost after commit'))))
    );
    mount({ rpcHandlersTransport, render });

    await selectProject({ act, fireEvent, screen });
    const picker = screen.getAllByRole('button', { name: t['collections.picker'] })[1]!;

    await act(async () => {
      fireEvent.click(picker);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const add = await screen.findByRole('button', {
      name: `${t['collections.add']}: Available discussion`
    });

    expect(
      screen.getByRole('button', { name: `${t['collections.add']}: Already attached` })
    ).toBeDisabled();
    await act(async () => {
      fireEvent.click(add);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText(t['collections.mutationError']);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `${t['collections.add']}: Available discussion` })
      ).toBeDisabled()
    );
    const section = picker.closest('section')!;

    await waitFor(() =>
      expect(within(section).getByRole('button', { name: t['collections.retry'] })).toBeEnabled()
    );
    await act(async () => {
      fireEvent.click(within(section).getByRole('button', { name: t['collections.members'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByRole('button', {
      name: `${t['collections.detach']}: Available discussion`
    });
    expect(rpc['projects.addNote']).toHaveBeenCalledExactlyOnceWith({
      projectId: project.id,
      noteId: note.id
    });
    expect(rpc['projects.removeNote']).not.toHaveBeenCalled();
  }
);

test.stable(
  'requires the exact subject name and fences dismissal while its native deletion is pending',
  async ({
    fireEvent,
    screen,
    within,
    expect,
    waitFor,
    userEvent,
    act,
    rpcHandlersTransport,
    render
  }) => {
    const response = deferred<boolean>();

    rpc['projects.deleteProject'].mockReturnValue(Effect.promise(() => response.promise));
    mount({ rpcHandlersTransport, render });
    await selectProject({ act, fireEvent, screen });
    fireEvent.click(
      detail({ within, screen }).getByRole('button', { name: t['collections.delete'] })
    );
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: t['collections.delete'] });
    const field = within(dialog).getByRole('textbox');

    expect(confirm).toBeDisabled();
    fireEvent.change(field, { target: { value: 'delete' } });
    expect(confirm).toBeDisabled();
    expect(rpc['projects.deleteProject']).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: project.name } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(rpc['projects.deleteProject']).toHaveBeenCalledExactlyOnceWith({
        id: project.id
      })
    );
    expect(within(dialog).getByRole('button', { name: t['collections.cancel'] })).toBeDisabled();
    await userEvent.setup().keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBe(dialog);
    await act(async () => response.resolve(true));
    await waitFor(() =>
      expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
        title: t.SubjectDeleted,
        type: 'success'
      })
    );
  }
);

test.stable(
  'does not announce a missing subject as deleted when the native receipt is false',
  async ({ fireEvent, screen, within, expect, rpcHandlersTransport, render, act }) => {
    rpc['projects.deleteProject'].mockReturnValue(Effect.succeed(false));
    mount({ rpcHandlersTransport, render });
    await selectProject({ act, fireEvent, screen });
    fireEvent.click(
      detail({ within, screen }).getByRole('button', { name: t['collections.delete'] })
    );
    const dialog = await screen.findByRole('alertdialog');

    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: project.name }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: t['collections.delete'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      t['collections.mutationError']
    );
    expect(toastManager.add).not.toHaveBeenCalled();
    expect(rpc['projects.deleteProject']).toHaveBeenCalledExactlyOnceWith({ id: project.id });
  }
);
