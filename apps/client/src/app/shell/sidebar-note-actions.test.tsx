import { StudyError } from '@study/contracts/errors';
import { noteIdSchema } from '@study/contracts/ids';
import { noteDeletionSchema } from '@study/contracts/notes/deletion';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
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

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { SidebarNoteActions } from './sidebar-note-actions';

const titles = vi.hoisted(() => ({ request: vi.fn(), executions: vi.fn() }));

const notices = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('@study/ui/toast', () => ({ toastManager: notices }));

const deletion = vi.hoisted(() => ({ remove: vi.fn(), read: vi.fn(), retry: vi.fn() }));

const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

const en = catalogs.english;

function mount() {
  deletion.read.mockRejectedValue(new StudyError('not_found', 'No deletion'));
  titles.executions.mockResolvedValue({ items: [], next: null });
  const client = rpcTestTransport(async (tag, input) => {
    if (tag === 'notes.requestTitle') return titles.request(input);

    if (tag === 'workflows.executions') return titles.executions(input);

    if (tag === 'notes.deleteNote') return deletion.remove(id);

    if (tag === 'notes.retryNoteDeletion') {
      const value = await deletion.retry(id);

      deletion.read.mockResolvedValue(value);

      return value;
    }

    if (tag === 'notes.noteDeletion') return deletion.read();

    throw new Error(tag);
  });
  const root = createRootRoute({
    component: () => (
      <client.wrapper>
        <SidebarNoteActions id={id} project="9007199254740995">
          <a href="/notes/9007199254740993">Cell division</a>
        </SidebarNoteActions>
      </client.wrapper>
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

vi.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));
