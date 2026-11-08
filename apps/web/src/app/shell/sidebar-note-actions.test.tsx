import { noteIdSchema } from '@study/contracts/ids';
import { noteDeletionSchema } from '@study/contracts/notes/deletion';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import type * as WorkspaceQueries from '#web/features/note-workspace/note-workspace.queries.ts';

import { SidebarNoteActions } from './sidebar-note-actions';

const titles = vi.hoisted(() => ({ request: vi.fn(), executions: vi.fn() }));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (fn: (client: unknown) => unknown) =>
    fn({ 'notes.requestTitle': titles.request, 'workflows.executions': titles.executions })
}));

const notices = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('@study/ui/toast', () => ({ toastManager: notices }));

const deletion = vi.hoisted(() => ({ remove: vi.fn(), read: vi.fn(), retry: vi.fn() }));

vi.mock('#web/features/note-workspace/note-workspace.queries.ts', async (load) => {
  const actual = await load<typeof WorkspaceQueries>();

  return {
    ...actual,
    deleteNoteMutationOptions: (id: unknown) => ({
      mutationFn: () => deletion.remove(id),
      retry: false
    }),
    retryNoteDeletionMutationOptions: (id: unknown) => ({
      mutationFn: () => deletion.retry(id),
      retry: false
    }),
    deletionOptions: (id: unknown) => ({
      queryKey: ['delete-note-test', String(id)],
      queryFn: deletion.read
    })
  };
});

const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

const en = catalogs.english;

const clients: QueryClient[] = [];

function mount() {
  deletion.read.mockResolvedValue(null);
  titles.executions.mockResolvedValue({ items: [], next: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <SidebarNoteActions id={id} project="9007199254740995">
          <a href="/notes/9007199254740993">Cell division</a>
        </SidebarNoteActions>
      </QueryClientProvider>
    )
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  render(<RouterProvider router={router} />);

  return router;
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();

  vi.clearAllMocks();
});

testStable(
  'opens note actions with right click and cancels deletion without a mutation',
  async () => {
    mount();
    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    const remove = await screen.findByRole('menuitem', { name: en.NoteDelete });

    await userEvent.setup().click(remove);
    const dialog = await screen.findByRole('alertdialog');

    expect(within(dialog).getByText(en.NoteDeleteHelp)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: en.Cancel })).toHaveFocus();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: en.Cancel }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(deletion.remove).not.toHaveBeenCalled();
  }
);

testStable(
  'opens the canonical note path from the context menu without adding row controls',
  async () => {
    const router = mount();

    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    expect(screen.queryByRole('button', { name: en.NoteActions })).not.toBeInTheDocument();
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: en.OpenNote }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notes/9007199254740993'));
    expect(router.state.location.search).toEqual({ project: '9007199254740995' });
  }
);

testStable('deletes only the exact note after explicit confirmation', async () => {
  deletion.remove.mockReturnValue(new Promise(() => {}));
  mount();
  const user = userEvent.setup();

  fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  await user.click(await screen.findByRole('menuitem', { name: en.NoteDelete }));
  const dialog = await screen.findByRole('alertdialog');

  expect(deletion.remove).not.toHaveBeenCalled();
  const confirm = await within(dialog).findByRole('button', { name: en.NoteConfirmDelete });

  expect(confirm).toBeDisabled();
  const phrase = within(dialog).getByRole('textbox');

  await user.type(phrase, 'wrong');
  expect(confirm).toBeDisabled();
  expect(deletion.remove).not.toHaveBeenCalled();
  await user.clear(phrase);
  await user.type(phrase, en.DeleteConfirmationWord);
  await user.click(confirm);
  await waitFor(() => expect(deletion.remove).toHaveBeenCalledExactlyOnceWith(id));
  expect(within(dialog).getByRole('status')).toHaveTextContent(en.NoteDeleting);
  expect(within(dialog).getByRole('button', { name: en.Cancel })).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('alertdialog')).toBe(dialog);
});

function receipt(status: 'failed' | 'completed') {
  return Schema.decodeUnknownSync(noteDeletionSchema)({
    noteId: id,
    operationId: 'delete-test',
    status,
    errorKind: status === 'failed' ? 'transient' : null,
    attempt: 1,
    completedAt: status === 'completed' ? 2n : null
  });
}

testStable(
  'announces an owned retry completion once and does not announce cached receipts',
  async () => {
    mount();
    deletion.read.mockResolvedValue(receipt('failed'));
    deletion.retry.mockResolvedValue(receipt('completed'));
    const user = userEvent.setup();

    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), {
      button: 2
    });
    await user.click(await screen.findByRole('menuitem', { name: en.NoteDelete }));
    const dialog = await screen.findByRole('alertdialog');

    await user.type(within(dialog).getByRole('textbox'), en.DeleteConfirmationWord);
    await user.click(await within(dialog).findByRole('button', { name: en.NoteRetryDelete }));
    await waitFor(() => expect(deletion.retry).toHaveBeenCalledExactlyOnceWith(id));
    await waitFor(() =>
      expect(notices.add).toHaveBeenCalledExactlyOnceWith({
        title: en.NoteDeleted,
        type: 'success'
      })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    deletion.read.mockResolvedValue(receipt('completed'));
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Cell division' }), { button: 2 });
    await user.click(await screen.findByRole('menuitem', { name: en.NoteDelete }));
    const cached = await screen.findByRole('alertdialog');

    expect(
      await within(cached).findByRole('button', { name: en.NoteConfirmDelete })
    ).toBeDisabled();
    expect(notices.add).toHaveBeenCalledTimes(1);
    expect(deletion.remove).not.toHaveBeenCalled();
  }
);

testStable('offers page creation in the note context menu', async () => {
  mount();
  fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  expect(await screen.findByRole('menuitem', { name: en.NoteTransform })).toBeVisible();
});

testStable('regenerates the selected note title without navigating', async () => {
  titles.request.mockResolvedValue({ noteId: id, requestId: 'title-request' });
  const router = mount();

  fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), { button: 2 });
  await userEvent.setup().click(await screen.findByRole('menuitem', { name: en.RegenerateTitle }));
  await waitFor(() => expect(titles.request).toHaveBeenCalledExactlyOnceWith({ noteId: id }));
  expect(router.state.location.pathname).toBe('/');
  expect(notices.add).not.toHaveBeenCalledWith({ title: en.RegeneratingTitle, type: 'info' });
});

testStable('reports title request failures and allows another attempt', async () => {
  titles.request.mockRejectedValue(new Error('Offline'));
  mount();
  const user = userEvent.setup();

  fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), { button: 2 });
  await user.click(await screen.findByRole('menuitem', { name: en.RegenerateTitle }));
  await waitFor(() =>
    expect(notices.add).toHaveBeenCalledWith({
      title: en.NoteActionErrorTitle,
      description: en.TitleGenerationError,
      type: 'error'
    })
  );
  titles.request.mockReturnValue(new Promise(() => {}));
  fireEvent.contextMenu(screen.getByRole('link', { name: 'Cell division' }), { button: 2 });
  await user.click(await screen.findByRole('menuitem', { name: en.RegenerateTitle }));
  await waitFor(() => expect(titles.request).toHaveBeenCalledTimes(2));
  fireEvent.contextMenu(screen.getByRole('link', { name: 'Cell division' }), { button: 2 });
  expect(await screen.findByRole('menuitem', { name: en.RegenerateTitle })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
});

testStable('refreshes titles when background generation completes', async () => {
  titles.request.mockResolvedValue({ noteId: id, requestId: 'completed-title' });
  mount();
  const client = clients.at(-1)!;

  client.setQueryData(['notes'], []);
  client.setQueryData(['search', 'cells'], []);
  titles.executions.mockResolvedValue({
    items: [{ status: 'completed', outcome: 'success' }],
    next: null
  });
  fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), { button: 2 });
  await userEvent.setup().click(await screen.findByRole('menuitem', { name: en.RegenerateTitle }));
  await waitFor(() => expect(client.getQueryState(['notes'])?.isInvalidated).toBe(true));
  expect(client.getQueryState(['search', 'cells'])?.isInvalidated).toBe(true);
});
