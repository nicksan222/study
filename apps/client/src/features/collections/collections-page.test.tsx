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

function mount() {
  const harness = test.rpcHandlersTransport(rpc);
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
  const view = test.render(
    <harness.wrapper>
      <LanguageProvider locale="english">
        <RouterProvider router={router} />
      </LanguageProvider>
    </harness.wrapper>
  );

  return { ...view, notify: harness.notify, router };
}

async function remount(router: ReturnType<typeof mount>['router']) {
  await test.act(async () => {
    await router.navigate({ to: '/home' });
  });
  await test.screen.findByText('Away');
  await test.act(async () => {
    await router.navigate({ to: '/projects' });
  });
  await test.screen.findByRole('button', { name: t['collections.create'] });
}

function createName() {
  return test.screen.getAllByRole('textbox', { name: t['collections.name'] })[0]!;
}

function detail() {
  return test.within(test.screen.getByRole('region', { name: 'Biology' }));
}

async function selectProject() {
  await test.act(async () => {
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'Biology' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.screen.findByRole('region', { name: 'Biology' });
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

test.beforeEach(() => {
  test.vi.resetAllMocks();
  rpc['projects.projects'].mockReturnValue(Effect.succeed({ items: [project], next: null }));
  rpc['projects.project'].mockReturnValue(Effect.succeed(project));
  rpc['materials.materials'].mockReturnValue(Effect.succeed({ items: [], nextCursor: null }));
  rpc['notes.notes'].mockReturnValue(Effect.succeed({ items: [], next: null }));
});

test.stable(
  'excludes duplicate create across a route remount and preserves a newer draft after the late receipt',
  async () => {
    const response = deferred<typeof project>();

    rpc['projects.createProject'].mockReturnValue(Effect.promise(() => response.promise));
    const { router } = mount();

    await test.screen.findByRole('button', { name: 'Biology' });
    await test.act(async () => {
      test.fireEvent.change(createName(), { target: { value: 'Submitted' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: t['collections.create'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText(t['collections.creating']);
    test.expect(test.screen.queryByText(t['collections.uncertain'])).toBeNull();
    await remount(router);
    await test.act(async () => {
      test.fireEvent.change(createName(), { target: { value: 'New unsent draft' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    test.expect(test.screen.getByRole('button', { name: t['collections.create'] })).toBeDisabled();
    test.expect(test.screen.queryByRole('button', { name: t['collections.reviewed'] })).toBeNull();
    await test.act(async () => {
      test.fireEvent.submit(createName().closest('form')!);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    test
      .expect(rpc['projects.createProject'])
      .toHaveBeenCalledExactlyOnceWith({ name: 'Submitted' });
    await test.act(async () => {
      response.resolve(project);
      await response.promise;
    });
    await test.screen.findByText(t['collections.created']);
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: t['collections.create'] })).toBeEnabled()
    );
    test.expect(createName()).toHaveValue('New unsent draft');
    test.expect(test.screen.queryByText(String(project.id))).toBeNull();
    await remount(router);
    test.expect(createName()).toHaveValue('New unsent draft');
  }
);

test.stable(
  'requires a fresh list review after settled ambiguous creation without replaying the write',
  async () => {
    rpc['projects.createProject'].mockReturnValue(
      Effect.fail(new StudyError('internal', 'response lost'))
    );
    const { router } = mount();

    await test.screen.findByRole('button', { name: 'Biology' });
    await test.act(async () => {
      test.fireEvent.change(createName(), { target: { value: 'Submitted' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: t['collections.create'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText(t['collections.uncertain']);
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: t['collections.retry'] })).toBeEnabled()
    );
    await remount(router);
    test
      .expect(test.screen.getByRole('button', { name: t['collections.reviewed'] }))
      .toBeDisabled();
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: t['collections.retry'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('button', { name: t['collections.reviewed'] }))
        .toBeEnabled()
    );
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: t['collections.reviewed'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: t['collections.create'] })).toBeEnabled()
    );
    test.expect(createName()).toHaveValue('Submitted');
    test.expect(rpc['projects.createProject']).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'serializes rename through remount and retains edits made after submission',
  async () => {
    const response = deferred<boolean>();

    rpc['projects.renameProject'].mockReturnValue(Effect.promise(() => response.promise));
    const { router } = mount();

    await selectProject();
    await test.act(async () => {
      test.fireEvent.change(detail().getByRole('textbox'), {
        target: { value: 'Submitted rename' }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.act(async () => {
      test.fireEvent.click(detail().getByRole('button', { name: t['collections.rename'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.waitFor(() => test.expect(rpc['projects.renameProject']).toHaveBeenCalledTimes(1));
    await remount(router);
    await test.screen.findByRole('region', { name: 'Biology' });
    await test.act(async () => {
      test.fireEvent.change(detail().getByRole('textbox'), {
        target: { value: 'New rename draft' }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    test.expect(detail().getByRole('button', { name: t['collections.rename'] })).toBeDisabled();
    await test.act(async () => {
      test.fireEvent.submit(detail().getByRole('textbox').closest('form')!);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.act(async () => {
      response.resolve(true);
      await response.promise;
    });
    await test.waitFor(() =>
      test.expect(detail().getByRole('button', { name: t['collections.rename'] })).toBeEnabled()
    );
    await remount(router);
    test.expect(await test.screen.findByRole('region', { name: 'Biology' })).toBeInTheDocument();
    test.expect(detail().getByRole('textbox')).toHaveValue('New rename draft');
    test.expect(rpc['projects.renameProject']).toHaveBeenCalledExactlyOnceWith({
      id: project.id,
      name: 'Submitted rename'
    });
  }
);

test.stable(
  'reads the selected identity exactly when it is absent from the reloaded catalog and shows canonical rename data',
  async () => {
    const { router } = mount();

    await selectProject();
    rpc['projects.projects'].mockReturnValue(Effect.succeed({ items: [], next: project.id }));
    rpc['projects.project'].mockReturnValue(Effect.succeed({ ...project, name: 'Canonical name' }));
    await remount(router);
    await test.screen.findByRole('region', { name: 'Canonical name' });
    test.expect(test.screen.queryByRole('button', { name: 'Biology' })).toBeNull();
    test
      .expect(
        test
          .within(test.screen.getByRole('region', { name: 'Canonical name' }))
          .getByRole('textbox')
      )
      .toHaveValue('Canonical name');
    test.expect(rpc['projects.project']).toHaveBeenLastCalledWith({ id: project.id });
  }
);

test.stable('treats a false rename receipt as missing and preserves its unsent name', async () => {
  rpc['projects.renameProject'].mockReturnValue(Effect.succeed(false));
  const { router } = mount();

  await selectProject();
  await test.act(async () => {
    test.fireEvent.change(detail().getByRole('textbox'), { target: { value: 'Keep this name' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.act(async () => {
    test.fireEvent.click(detail().getByRole('button', { name: t['collections.rename'] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.screen.findByText(t['collections.missing']);
  await test.waitFor(() =>
    test.expect(detail().getByRole('button', { name: t['collections.rename'] })).toBeEnabled()
  );
  await remount(router);
  await test.screen.findByRole('region', { name: 'Biology' });
  test.expect(detail().getByRole('textbox')).toHaveValue('Keep this name');
});

test.stable(
  'hides stale selected controls and the accepted receipt when the exact project becomes missing',
  async () => {
    rpc['projects.createProject'].mockReturnValue(Effect.succeed(project));
    mount();
    await test.screen.findByRole('button', { name: 'Biology' });
    await test.act(async () => {
      test.fireEvent.change(createName(), { target: { value: 'Biology' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: t['collections.create'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText(t['collections.created']);
    await test.waitFor(() =>
      test
        .expect(test.screen.getAllByRole('button', { name: t['collections.retry'] })[0])
        .toBeEnabled()
    );
    rpc['projects.project'].mockReturnValue(Effect.fail(new StudyError('not_found', 'gone')));
    await test.act(async () => {
      test.fireEvent.click(
        test.screen.getAllByRole('button', { name: t['collections.retry'] })[0]!
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText(t['collections.missing']);
    test.expect(test.screen.queryByRole('region', { name: 'Biology' })).toBeNull();
    await test.waitFor(() =>
      test.expect(test.screen.queryByText(t['collections.created'])).toBeNull()
    );
  }
);

test.stable.each(['materials', 'notes'] as const)(
  'reconciles an ambiguous %s membership response and supports explicit refresh without replay',
  async (kind) => {
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
    const { notify } = mount();

    await selectProject();
    const title = kind === 'materials' ? 'Reading' : 'Discussion';
    const button = await test.screen.findByRole('button', {
      name: `${t['collections.detach']}: ${title}`
    });
    const section = button.closest('section')!;

    await test.act(async () => {
      test.fireEvent.click(button);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText(t['collections.mutationError']);
    await test.act(() => notify());
    await test.waitFor(() => test.expect(test.within(section).queryByText(title)).toBeNull());
    await test.waitFor(() =>
      test
        .expect(test.within(section).getByRole('button', { name: t['collections.retry'] }))
        .toBeEnabled()
    );
    test.expect(test.within(section).getByText(t['collections.emptyMembers'])).toBeInTheDocument();
    member = true;
    await test.act(async () => {
      test.fireEvent.click(
        test.within(section).getByRole('button', { name: t['collections.retry'] })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.within(section).findByText(title);
    test.expect(test.screen.getByText(t['collections.mutationError'])).toBeInTheDocument();
    test.expect(remove).toHaveBeenCalledTimes(1);
    test
      .expect(remove)
      .toHaveBeenCalledWith(
        kind === 'materials'
          ? { projectId: project.id, materialId: material.id }
          : { projectId: project.id, noteId: note.id }
      );
  }
);

test.stable('provides contextual empty guidance for catalog, members and picker', async () => {
  rpc['projects.projects'].mockReturnValueOnce(Effect.succeed({ items: [], next: null }));
  const { notify } = mount();

  await test.screen.findByText(t['collections.emptyCatalog']);
  await test.act(async () => {
    await notify();
  });
  await selectProject();
  await test.waitFor(() =>
    test.expect(test.screen.getAllByText(t['collections.emptyMembers'])).toHaveLength(2)
  );
  await test.act(async () => {
    test.fireEvent.click(test.screen.getAllByRole('button', { name: t['collections.picker'] })[0]!);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.screen.findByText(t['collections.emptyPicker']);
});

test.stable(
  'keeps typed invalid-input rejection editable without an ambiguous-create acknowledgement',
  async () => {
    rpc['projects.createProject'].mockReturnValue(
      Effect.fail(new StudyError('invalid_input', 'rejected'))
    );
    mount();
    await test.screen.findByRole('button', { name: 'Biology' });
    await test.act(async () => {
      test.fireEvent.change(createName(), { target: { value: 'Rejected draft' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: t['collections.create'] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText(t['collections.invalidName']);
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: t['collections.create'] })).toBeEnabled()
    );
    test.expect(createName()).toHaveValue('Rejected draft');
    test.expect(test.screen.queryByText(t['collections.uncertain'])).toBeNull();
    test.expect(test.screen.queryByRole('button', { name: t['collections.reviewed'] })).toBeNull();
    test.expect(rpc['projects.createProject']).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'uses complete projectIds in the picker and reconciles a lost add response without replay',
  async () => {
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
    mount();

    await selectProject();
    const picker = test.screen.getAllByRole('button', { name: t['collections.picker'] })[1]!;

    await test.act(async () => {
      test.fireEvent.click(picker);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const add = await test.screen.findByRole('button', {
      name: `${t['collections.add']}: Available discussion`
    });

    test
      .expect(
        test.screen.getByRole('button', { name: `${t['collections.add']}: Already attached` })
      )
      .toBeDisabled();
    await test.act(async () => {
      test.fireEvent.click(add);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText(t['collections.mutationError']);
    await test.waitFor(() =>
      test
        .expect(
          test.screen.getByRole('button', { name: `${t['collections.add']}: Available discussion` })
        )
        .toBeDisabled()
    );
    const section = picker.closest('section')!;

    await test.waitFor(() =>
      test
        .expect(test.within(section).getByRole('button', { name: t['collections.retry'] }))
        .toBeEnabled()
    );
    await test.act(async () => {
      test.fireEvent.click(
        test.within(section).getByRole('button', { name: t['collections.members'] })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByRole('button', {
      name: `${t['collections.detach']}: Available discussion`
    });
    test.expect(rpc['projects.addNote']).toHaveBeenCalledExactlyOnceWith({
      projectId: project.id,
      noteId: note.id
    });
    test.expect(rpc['projects.removeNote']).not.toHaveBeenCalled();
  }
);

test.stable(
  'requires the exact subject name and fences dismissal while its native deletion is pending',
  async () => {
    const response = deferred<boolean>();

    rpc['projects.deleteProject'].mockReturnValue(Effect.promise(() => response.promise));
    mount();
    await selectProject();
    test.fireEvent.click(detail().getByRole('button', { name: t['collections.delete'] }));
    const dialog = await test.screen.findByRole('alertdialog');
    const confirm = test.within(dialog).getByRole('button', { name: t['collections.delete'] });
    const field = test.within(dialog).getByRole('textbox');

    test.expect(confirm).toBeDisabled();
    test.fireEvent.change(field, { target: { value: 'delete' } });
    test.expect(confirm).toBeDisabled();
    test.expect(rpc['projects.deleteProject']).not.toHaveBeenCalled();
    test.fireEvent.change(field, { target: { value: project.name } });
    test.fireEvent.click(confirm);
    await test.waitFor(() =>
      test.expect(rpc['projects.deleteProject']).toHaveBeenCalledExactlyOnceWith({
        id: project.id
      })
    );
    test
      .expect(test.within(dialog).getByRole('button', { name: t['collections.cancel'] }))
      .toBeDisabled();
    await test.userEvent.setup().keyboard('{Escape}');
    test.expect(test.screen.getByRole('alertdialog')).toBe(dialog);
    await test.act(async () => response.resolve(true));
    await test.waitFor(() =>
      test.expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
        title: t.SubjectDeleted,
        type: 'success'
      })
    );
  }
);

test.stable(
  'does not announce a missing subject as deleted when the native receipt is false',
  async () => {
    rpc['projects.deleteProject'].mockReturnValue(Effect.succeed(false));
    mount();
    await selectProject();
    test.fireEvent.click(detail().getByRole('button', { name: t['collections.delete'] }));
    const dialog = await test.screen.findByRole('alertdialog');

    test.fireEvent.change(test.within(dialog).getByRole('textbox'), {
      target: { value: project.name }
    });
    test.fireEvent.click(
      test.within(dialog).getByRole('button', { name: t['collections.delete'] })
    );
    test
      .expect(await test.within(dialog).findByRole('alert'))
      .toHaveTextContent(t['collections.mutationError']);
    test.expect(toastManager.add).not.toHaveBeenCalled();
    test.expect(rpc['projects.deleteProject']).toHaveBeenCalledExactlyOnceWith({ id: project.id });
  }
);
