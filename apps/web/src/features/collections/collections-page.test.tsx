import { sessionSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { materialSummarySchema } from '@study/contracts/materials/schemas';
import { projectSchema } from '@study/contracts/projects/schemas';
import { catalogs } from '@study/localization';
import { toastManager } from '@study/ui/toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  stringifySearchWith,
  RouterProvider
} from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { LanguageProvider } from '../../lib/i18n';
import type { StudyClient } from '../../lib/study-client/client';
import { CollectionsPage } from './collections-page';

vi.mock('@study/ui/toast', () => ({ toastManager: { add: vi.fn() } }));

const rpc = vi.hoisted(() => ({
  'projects.projects': vi.fn<StudyClient['projects.projects']>(),
  'projects.project': vi.fn<StudyClient['projects.project']>(),
  'projects.createProject': vi.fn<StudyClient['projects.createProject']>(),
  'projects.deleteProject': vi.fn<StudyClient['projects.deleteProject']>(),
  'projects.renameProject': vi.fn<StudyClient['projects.renameProject']>(),
  'projects.addMaterial': vi.fn<StudyClient['projects.addMaterial']>(),
  'projects.removeMaterial': vi.fn<StudyClient['projects.removeMaterial']>(),
  'projects.addSession': vi.fn<StudyClient['projects.addSession']>(),
  'projects.removeSession': vi.fn<StudyClient['projects.removeSession']>(),
  'materials.materials': vi.fn<StudyClient['materials.materials']>(),
  'conversations.sessions': vi.fn<StudyClient['conversations.sessions']>()
}));

vi.mock('../../lib/study-client/client', async () => {
  const { Effect } = await import('effect');

  return { studyClient: Effect.succeed(rpc) };
});

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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
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
    <QueryClientProvider client={client}>
      <LanguageProvider locale="english">
        <RouterProvider router={router} />
      </LanguageProvider>
    </QueryClientProvider>
  );

  return { ...view, client, router };
}

async function remount(router: ReturnType<typeof mount>['router']) {
  await act(async () => {
    await router.navigate({ to: '/home' });
  });
  await screen.findByText('Away');
  await act(async () => {
    await router.navigate({ to: '/projects' });
  });
  await screen.findByRole('button', { name: t['collections.create'] });
}

function createName() {
  return screen.getAllByRole('textbox', { name: t['collections.name'] })[0]!;
}

function detail() {
  return within(screen.getByRole('region', { name: 'Biology' }));
}

async function selectProject() {
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Biology' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await screen.findByRole('region', { name: 'Biology' });
}

beforeEach(() => {
  vi.resetAllMocks();
  rpc['projects.projects'].mockReturnValue(Effect.succeed({ items: [project], next: null }));
  rpc['projects.project'].mockReturnValue(Effect.succeed(project));
  rpc['materials.materials'].mockReturnValue(Effect.succeed({ items: [], nextCursor: null }));
  rpc['conversations.sessions'].mockReturnValue(Effect.succeed({ items: [], next: null }));
});

it('excludes duplicate create across a route remount and preserves a newer draft after the late receipt', async () => {
  const response = deferred<typeof project>();

  rpc['projects.createProject'].mockReturnValue(Effect.promise(() => response.promise));
  const { router } = mount();

  await screen.findByRole('button', { name: 'Biology' });
  await act(async () => {
    fireEvent.change(createName(), { target: { value: 'Submitted' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: t['collections.create'] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await screen.findByText(t['collections.creating']);
  expect(screen.queryByText(t['collections.uncertain'])).toBeNull();
  await remount(router);
  await act(async () => {
    fireEvent.change(createName(), { target: { value: 'New unsent draft' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.getByRole('button', { name: t['collections.create'] })).toBeDisabled();
  expect(screen.queryByRole('button', { name: t['collections.reviewed'] })).toBeNull();
  await act(async () => {
    fireEvent.submit(createName().closest('form')!);
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
  expect(createName()).toHaveValue('New unsent draft');
  expect(screen.queryByText(String(project.id))).toBeNull();
  await remount(router);
  expect(createName()).toHaveValue('New unsent draft');
});

it('requires a fresh list review after settled ambiguous creation without replaying the write', async () => {
  rpc['projects.createProject'].mockReturnValue(
    Effect.fail(new StudyError('internal', 'response lost'))
  );
  const { router } = mount();

  await screen.findByRole('button', { name: 'Biology' });
  await act(async () => {
    fireEvent.change(createName(), { target: { value: 'Submitted' } });
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
  await remount(router);
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
  expect(createName()).toHaveValue('Submitted');
  expect(rpc['projects.createProject']).toHaveBeenCalledTimes(1);
});

it('serializes rename through remount and retains edits made after submission', async () => {
  const response = deferred<boolean>();

  rpc['projects.renameProject'].mockReturnValue(Effect.promise(() => response.promise));
  const { router } = mount();

  await selectProject();
  await act(async () => {
    fireEvent.change(detail().getByRole('textbox'), { target: { value: 'Submitted rename' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    fireEvent.click(detail().getByRole('button', { name: t['collections.rename'] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(rpc['projects.renameProject']).toHaveBeenCalledTimes(1));
  await remount(router);
  await screen.findByRole('region', { name: 'Biology' });
  await act(async () => {
    fireEvent.change(detail().getByRole('textbox'), { target: { value: 'New rename draft' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(detail().getByRole('button', { name: t['collections.rename'] })).toBeDisabled();
  await act(async () => {
    fireEvent.submit(detail().getByRole('textbox').closest('form')!);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    response.resolve(true);
    await response.promise;
  });
  await waitFor(() =>
    expect(detail().getByRole('button', { name: t['collections.rename'] })).toBeEnabled()
  );
  await remount(router);
  expect(await screen.findByRole('region', { name: 'Biology' })).toBeInTheDocument();
  expect(detail().getByRole('textbox')).toHaveValue('New rename draft');
  expect(rpc['projects.renameProject']).toHaveBeenCalledExactlyOnceWith({
    id: project.id,
    name: 'Submitted rename'
  });
});

it('reads the selected identity exactly when it is absent from the reloaded catalog and shows canonical rename data', async () => {
  const { router } = mount();

  await selectProject();
  rpc['projects.projects'].mockReturnValue(Effect.succeed({ items: [], next: project.id }));
  rpc['projects.project'].mockReturnValue(Effect.succeed({ ...project, name: 'Canonical name' }));
  await remount(router);
  await screen.findByRole('region', { name: 'Canonical name' });
  expect(screen.queryByRole('button', { name: 'Biology' })).toBeNull();
  expect(
    within(screen.getByRole('region', { name: 'Canonical name' })).getByRole('textbox')
  ).toHaveValue('Canonical name');
  expect(rpc['projects.project']).toHaveBeenLastCalledWith({ id: project.id });
  expect(screen.getByRole('link', { name: t['collections.library'] })).toHaveAttribute(
    'href',
    `/library?project=${project.id}`
  );
});

it('treats a false rename receipt as missing and preserves its unsent name', async () => {
  rpc['projects.renameProject'].mockReturnValue(Effect.succeed(false));
  const { router } = mount();

  await selectProject();
  await act(async () => {
    fireEvent.change(detail().getByRole('textbox'), { target: { value: 'Keep this name' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    fireEvent.click(detail().getByRole('button', { name: t['collections.rename'] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await screen.findByText(t['collections.missing']);
  await waitFor(() =>
    expect(detail().getByRole('button', { name: t['collections.rename'] })).toBeEnabled()
  );
  await remount(router);
  await screen.findByRole('region', { name: 'Biology' });
  expect(detail().getByRole('textbox')).toHaveValue('Keep this name');
});

it('hides stale selected controls and the accepted receipt when the exact project becomes missing', async () => {
  rpc['projects.createProject'].mockReturnValue(Effect.succeed(project));
  mount();
  await screen.findByRole('button', { name: 'Biology' });
  await act(async () => {
    fireEvent.change(createName(), { target: { value: 'Biology' } });
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
});

it.each(['materials', 'sessions'] as const)(
  'reconciles an ambiguous %s membership response and supports explicit refresh without replay',
  async (kind) => {
    let member = true;
    const material = Schema.decodeUnknownSync(materialSummarySchema)({
      id: 7n,
      projectIds: [project.id],
      kind: 'link',
      title: 'Reading',
      created_at: 1n,
      updated_at: 1n,
      archived_at: null,
      version: {
        id: 8n,
        material_id: 7n,
        kind: 'link',
        number: 1n,
        status: 'published',
        operation: 'original',
        creator: 'import',
        instruction: null,
        language: null,
        created_at: 1n,
        published_at: 1n
      },
      latestPublishedVersion: null,
      latestDraftVersion: null
    });
    const session = Schema.decodeUnknownSync(sessionSchema)({
      id: 9n,
      projectIds: [project.id],
      title: 'Discussion',
      titleSource: 'user',
      createdAt: 1n,
      updatedAt: 1n
    });

    rpc['materials.materials'].mockImplementation(() =>
      Effect.succeed({ items: member ? [material] : [], nextCursor: null })
    );
    rpc['conversations.sessions'].mockImplementation(() =>
      Effect.succeed({ items: member ? [session] : [], next: null })
    );
    const remove =
      kind === 'materials' ? rpc['projects.removeMaterial'] : rpc['projects.removeSession'];
    const failed = () =>
      Effect.sync(() => {
        member = false;
      }).pipe(
        Effect.flatMap(() => Effect.fail(new StudyError('internal', 'lost response after commit')))
      );

    rpc['projects.removeMaterial'].mockImplementation(failed);
    rpc['projects.removeSession'].mockImplementation(failed);
    mount();
    await selectProject();
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
        : { projectId: project.id, sessionId: session.id }
    );
  }
);

it('provides contextual empty guidance for catalog, members and picker', async () => {
  rpc['projects.projects'].mockReturnValueOnce(Effect.succeed({ items: [], next: null }));
  const { client } = mount();

  await screen.findByText(t['collections.emptyCatalog']);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['projects'] });
  });
  await selectProject();
  await waitFor(() => expect(screen.getAllByText(t['collections.emptyMembers'])).toHaveLength(2));
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: t['collections.picker'] })[0]!);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await screen.findByText(t['collections.emptyPicker']);
});

it('keeps typed invalid-input rejection editable without an ambiguous-create acknowledgement', async () => {
  rpc['projects.createProject'].mockReturnValue(
    Effect.fail(new StudyError('invalid_input', 'rejected'))
  );
  mount();
  await screen.findByRole('button', { name: 'Biology' });
  await act(async () => {
    fireEvent.change(createName(), { target: { value: 'Rejected draft' } });
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
  expect(createName()).toHaveValue('Rejected draft');
  expect(screen.queryByText(t['collections.uncertain'])).toBeNull();
  expect(screen.queryByRole('button', { name: t['collections.reviewed'] })).toBeNull();
  expect(rpc['projects.createProject']).toHaveBeenCalledTimes(1);
});

it('uses complete projectIds in the picker and reconciles a lost add response without replay', async () => {
  let attached = false;
  const session = Schema.decodeUnknownSync(sessionSchema)({
    id: 9n,
    projectIds: [],
    title: 'Available discussion',
    titleSource: 'user',
    createdAt: 1n,
    updatedAt: 1n
  });
  const existing = {
    ...session,
    id: Schema.decodeUnknownSync(sessionSchema)({ ...session, id: 10n }).id,
    title: 'Already attached',
    projectIds: [project.id]
  };

  rpc['conversations.sessions'].mockImplementation(({ project: filter }) =>
    Effect.succeed({
      items: filter
        ? attached
          ? [{ ...session, projectIds: [project.id] }]
          : []
        : [{ ...session, projectIds: attached ? [project.id] : [] }, existing],
      next: null
    })
  );
  rpc['projects.addSession'].mockImplementation(() =>
    Effect.sync(() => {
      attached = true;
    }).pipe(Effect.flatMap(() => Effect.fail(new StudyError('internal', 'lost after commit'))))
  );
  const { client } = mount();
  // Inactive consumers must also become stale when an ambiguous write settles.
  const sidebarKeys = [
    ['projects'],
    ['sessions'],
    ['session-workspace', 'cached'],
    ['search', 'cached']
  ];

  for (const key of sidebarKeys) client.setQueryData(key, 'cached');

  await selectProject();
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
  await screen.findByRole('button', { name: `${t['collections.detach']}: Available discussion` });
  expect(rpc['projects.addSession']).toHaveBeenCalledExactlyOnceWith({
    projectId: project.id,
    sessionId: session.id
  });
  expect(rpc['projects.removeSession']).not.toHaveBeenCalled();

  for (const key of sidebarKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});

it('requires the exact subject name and fences dismissal while its native deletion is pending', async () => {
  const response = deferred<boolean>();
  rpc['projects.deleteProject'].mockReturnValue(Effect.promise(() => response.promise));
  mount();
  await selectProject();
  fireEvent.click(detail().getByRole('button', { name: t['collections.delete'] }));
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
});

it('does not announce a missing subject as deleted when the native receipt is false', async () => {
  rpc['projects.deleteProject'].mockReturnValue(Effect.succeed(false));
  mount();
  await selectProject();
  fireEvent.click(detail().getByRole('button', { name: t['collections.delete'] }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: project.name } });
  fireEvent.click(within(dialog).getByRole('button', { name: t['collections.delete'] }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    t['collections.mutationError']
  );
  expect(toastManager.add).not.toHaveBeenCalled();
  expect(rpc['projects.deleteProject']).toHaveBeenCalledExactlyOnceWith({ id: project.id });
});
