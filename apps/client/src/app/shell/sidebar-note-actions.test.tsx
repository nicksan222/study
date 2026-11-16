import { StudyError, noteIdSchema, noteDeletionSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type * as UiModule from '@study/ui';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { Schema } from 'effect';

import type * as __StudyMockType0 from '#client/app/shell/sidebar-note-actions.tsx';

function createTitles(mock: test.Mock) {
  return { request: mock.fn(), executions: mock.fn() };
}

let titles: ReturnType<typeof createTitles>;

function createNotices(mock: test.Mock) {
  return { add: mock.fn() };
}

let notices: ReturnType<typeof createNotices>;

function createDeletion(mock: test.Mock) {
  return {
    remove: mock.fn(),
    read: mock.fn(),
    retry: mock.fn()
  };
}

let deletion: ReturnType<typeof createDeletion>;

let SidebarNoteActions: typeof __StudyMockType0.SidebarNoteActions;

test.beforeEach(async ({ mock }) => {
  titles = createTitles(mock);
  notices = createNotices(mock);
  deletion = createDeletion(mock);
  mock('@study/ui', async (load) => {
    const actual = await load<typeof UiModule>();

    return { ...actual, toastManager: { ...actual.toastManager, ...notices } };
  });
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));
  const __studyMockModule0 = await import('./sidebar-note-actions');

  SidebarNoteActions = __studyMockModule0.SidebarNoteActions;
});

const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

const en = catalogs.english;

function mount() {
  deletion.read.mockRejectedValue(new StudyError('not_found', 'No deletion'));
  titles.executions.mockResolvedValue({ items: [], next: null });
  const client = test.rpcTestTransport(async (tag, input) => {
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

  test.render(<RouterProvider router={router} />);

  return router;
}

test.afterEach(() => {
  test.vi.clearAllMocks();
});

test.stable(
  'opens note actions with right click and cancels deletion without a mutation',
  async () => {
    mount();
    test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: 'Cell division' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    const remove = await test.screen.findByRole('menuitem', { name: en.NoteDelete });

    await test.userEvent.setup().click(remove);
    const dialog = await test.screen.findByRole('alertdialog');

    test.expect(test.within(dialog).getByText(en.NoteDeleteHelp)).toBeVisible();
    test.expect(test.within(dialog).getByRole('button', { name: en.Cancel })).toHaveFocus();
    await test.userEvent
      .setup()
      .click(test.within(dialog).getByRole('button', { name: en.Cancel }));
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
    test.expect(deletion.remove).not.toHaveBeenCalled();
  }
);

test.stable(
  'opens the canonical note path from the context menu without adding row controls',
  async () => {
    const router = mount();

    test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: 'Cell division' }), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    test
      .expect(test.screen.queryByRole('button', { name: en.NoteActions }))
      .not.toBeInTheDocument();
    await test.userEvent
      .setup()
      .click(await test.screen.findByRole('menuitem', { name: en.OpenNote }));
    await test.waitFor(() =>
      test.expect(router.state.location.pathname).toBe('/notes/9007199254740993')
    );
    test.expect(router.state.location.search).toEqual({ project: '9007199254740995' });
  }
);

test.stable('deletes only the exact note after explicit confirmation', async () => {
  deletion.remove.mockReturnValue(new Promise(() => {}));
  mount();
  const user = test.userEvent.setup();

  test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: 'Cell division' }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  await user.click(await test.screen.findByRole('menuitem', { name: en.NoteDelete }));
  const dialog = await test.screen.findByRole('alertdialog');

  test.expect(deletion.remove).not.toHaveBeenCalled();
  const confirm = await test.within(dialog).findByRole('button', { name: en.NoteConfirmDelete });

  test.expect(confirm).toBeDisabled();
  const phrase = test.within(dialog).getByRole('textbox');

  await user.type(phrase, 'wrong');
  test.expect(confirm).toBeDisabled();
  test.expect(deletion.remove).not.toHaveBeenCalled();
  await user.clear(phrase);
  await user.type(phrase, en.DeleteConfirmationWord);
  await user.click(confirm);
  await test.waitFor(() => test.expect(deletion.remove).toHaveBeenCalledExactlyOnceWith(id));
  test.expect(test.within(dialog).getByRole('status')).toHaveTextContent(en.NoteDeleting);
  test.expect(test.within(dialog).getByRole('button', { name: en.Cancel })).toBeDisabled();
  await user.keyboard('{Escape}');
  test.expect(test.screen.getByRole('alertdialog')).toBe(dialog);
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

test.stable(
  'announces an owned retry completion once and does not announce cached receipts',
  async () => {
    mount();
    deletion.read.mockResolvedValue(receipt('failed'));
    deletion.retry.mockResolvedValue(receipt('completed'));
    const user = test.userEvent.setup();

    test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: 'Cell division' }), {
      button: 2
    });
    await user.click(await test.screen.findByRole('menuitem', { name: en.NoteDelete }));
    const dialog = await test.screen.findByRole('alertdialog');

    await user.type(test.within(dialog).getByRole('textbox'), en.DeleteConfirmationWord);
    await user.click(await test.within(dialog).findByRole('button', { name: en.NoteRetryDelete }));
    await test.waitFor(() => test.expect(deletion.retry).toHaveBeenCalledExactlyOnceWith(id));
    await test.waitFor(() =>
      test.expect(notices.add).toHaveBeenCalledExactlyOnceWith({
        title: en.NoteDeleted,
        type: 'success'
      })
    );
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );

    deletion.read.mockResolvedValue(receipt('completed'));
    test.fireEvent.contextMenu(test.screen.getByRole('link', { name: 'Cell division' }), {
      button: 2
    });
    await user.click(await test.screen.findByRole('menuitem', { name: en.NoteDelete }));
    const cached = await test.screen.findByRole('alertdialog');

    test
      .expect(await test.within(cached).findByRole('button', { name: en.NoteConfirmDelete }))
      .toBeDisabled();
    test.expect(notices.add).toHaveBeenCalledTimes(1);
    test.expect(deletion.remove).not.toHaveBeenCalled();
  }
);

test.stable('offers page creation in the note context menu', async () => {
  mount();
  test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: 'Cell division' }), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  test.expect(await test.screen.findByRole('menuitem', { name: en.NoteTransform })).toBeVisible();
});

test.stable('regenerates the selected note title without navigating', async () => {
  titles.request.mockResolvedValue({ noteId: id, requestId: 'title-request' });
  const router = mount();

  test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: 'Cell division' }), {
    button: 2
  });
  await test.userEvent
    .setup()
    .click(await test.screen.findByRole('menuitem', { name: en.RegenerateTitle }));
  await test.waitFor(() =>
    test.expect(titles.request).toHaveBeenCalledExactlyOnceWith({ noteId: id })
  );
  test.expect(router.state.location.pathname).toBe('/');
  test.expect(notices.add).not.toHaveBeenCalledWith({ title: en.RegeneratingTitle, type: 'info' });
});

test.stable('reports title request failures and allows another attempt', async () => {
  titles.request.mockRejectedValue(new Error('Offline'));
  mount();
  const user = test.userEvent.setup();

  test.fireEvent.contextMenu(await test.screen.findByRole('link', { name: 'Cell division' }), {
    button: 2
  });
  await user.click(await test.screen.findByRole('menuitem', { name: en.RegenerateTitle }));
  await test.waitFor(() =>
    test.expect(notices.add).toHaveBeenCalledWith({
      title: en.NoteActionErrorTitle,
      description: en.TitleGenerationError,
      type: 'error'
    })
  );
  titles.request.mockReturnValue(new Promise(() => {}));
  test.fireEvent.contextMenu(test.screen.getByRole('link', { name: 'Cell division' }), {
    button: 2
  });
  await user.click(await test.screen.findByRole('menuitem', { name: en.RegenerateTitle }));
  await test.waitFor(() => test.expect(titles.request).toHaveBeenCalledTimes(2));
  test.fireEvent.contextMenu(test.screen.getByRole('link', { name: 'Cell division' }), {
    button: 2
  });
  test
    .expect(await test.screen.findByRole('menuitem', { name: en.RegenerateTitle }))
    .toHaveAttribute('aria-disabled', 'true');
});
