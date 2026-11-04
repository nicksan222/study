import { sessionDeletionSchema } from '@study/contracts/conversations/deletion';
import { sessionIdSchema } from '@study/contracts/ids';
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

import type * as WorkspaceQueries from '#web/features/session-workspace/session-workspace.queries.ts';

import { SidebarSessionActions } from './sidebar-session-actions';

const notices = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('@study/ui/toast', () => ({ toastManager: notices }));

const deletion = vi.hoisted(() => ({ remove: vi.fn(), read: vi.fn(), retry: vi.fn() }));

vi.mock('#web/features/session-workspace/session-workspace.queries.ts', async (load) => {
  const actual = await load<typeof WorkspaceQueries>();

  return {
    ...actual,
    deleteSessionMutationOptions: (id: unknown) => ({
      mutationFn: () => deletion.remove(id),
      retry: false
    }),
    retrySessionDeletionMutationOptions: (id: unknown) => ({
      mutationFn: () => deletion.retry(id),
      retry: false
    }),
    deletionOptions: (id: unknown) => ({
      queryKey: ['delete-session-test', String(id)],
      queryFn: deletion.read
    })
  };
});

const id = Schema.decodeUnknownSync(sessionIdSchema)(9007199254740993n);

const en = catalogs.english;

const clients: QueryClient[] = [];

function mount() {
  deletion.read.mockResolvedValue(null);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <SidebarSessionActions id={id} project="9007199254740995">
          <a href="/sessions/9007199254740993">Cell division</a>
        </SidebarSessionActions>
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
  'opens session actions with right click and cancels deletion without a mutation',
  async () => {
    mount();
    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    const remove = await screen.findByRole('menuitem', { name: en.SessionDelete });

    await userEvent.setup().click(remove);
    const dialog = await screen.findByRole('alertdialog');

    expect(within(dialog).getByText(en.SessionDeleteHelp)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: en.Cancel })).toHaveFocus();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: en.Cancel }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(deletion.remove).not.toHaveBeenCalled();
  }
);

testStable(
  'opens the canonical session path from the context menu without adding row controls',
  async () => {
    const router = mount();

    fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    expect(screen.queryByRole('button', { name: en.SessionActions })).not.toBeInTheDocument();
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: en.OpenSession }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/9007199254740993'));
    expect(router.state.location.search).toEqual({ project: '9007199254740995' });
  }
);

testStable('deletes only the exact session after explicit confirmation', async () => {
  deletion.remove.mockReturnValue(new Promise(() => {}));
  mount();
  const user = userEvent.setup();

  fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  await user.click(await screen.findByRole('menuitem', { name: en.SessionDelete }));
  const dialog = await screen.findByRole('alertdialog');

  expect(deletion.remove).not.toHaveBeenCalled();
  const confirm = await within(dialog).findByRole('button', { name: en.SessionConfirmDelete });

  expect(confirm).toBeDisabled();
  const phrase = within(dialog).getByRole('textbox');

  await user.type(phrase, 'wrong');
  expect(confirm).toBeDisabled();
  expect(deletion.remove).not.toHaveBeenCalled();
  await user.clear(phrase);
  await user.type(phrase, en.DeleteConfirmationWord);
  await user.click(confirm);
  await waitFor(() => expect(deletion.remove).toHaveBeenCalledExactlyOnceWith(id));
  expect(within(dialog).getByRole('status')).toHaveTextContent(en.SessionDeleting);
  expect(within(dialog).getByRole('button', { name: en.Cancel })).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('alertdialog')).toBe(dialog);
});

function receipt(status: 'failed' | 'completed') {
  return Schema.decodeUnknownSync(sessionDeletionSchema)({
    sessionId: id,
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
    await user.click(await screen.findByRole('menuitem', { name: en.SessionDelete }));
    const dialog = await screen.findByRole('alertdialog');

    await user.type(within(dialog).getByRole('textbox'), en.DeleteConfirmationWord);
    await user.click(await within(dialog).findByRole('button', { name: en.SessionRetryDelete }));
    await waitFor(() => expect(deletion.retry).toHaveBeenCalledExactlyOnceWith(id));
    await waitFor(() =>
      expect(notices.add).toHaveBeenCalledExactlyOnceWith({
        title: en.SessionDeleted,
        type: 'success'
      })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    deletion.read.mockResolvedValue(receipt('completed'));
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Cell division' }), { button: 2 });
    await user.click(await screen.findByRole('menuitem', { name: en.SessionDelete }));
    const cached = await screen.findByRole('alertdialog');

    expect(
      await within(cached).findByRole('button', { name: en.SessionConfirmDelete })
    ).toBeDisabled();
    expect(notices.add).toHaveBeenCalledTimes(1);
    expect(deletion.remove).not.toHaveBeenCalled();
  }
);

testStable('offers document creation in the session context menu', async () => {
  mount();
  fireEvent.contextMenu(await screen.findByRole('link', { name: 'Cell division' }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  expect(await screen.findByRole('menuitem', { name: en.SessionTransform })).toBeVisible();
});
