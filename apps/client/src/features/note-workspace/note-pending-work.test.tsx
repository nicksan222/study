import { noteIdSchema, executionIdSchema } from '@study/contracts';
import type { noteWorkItemSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from './note-pending-work';

let NotePendingWork: typeof __MockType0.NotePendingWork;

let api: ReturnType<typeof createMockState>['api'];

const id = Schema.decodeUnknownSync(noteIdSchema)(1n);

const row: typeof noteWorkItemSchema.Type = {
  kind: 'reply',
  title: null,
  requestId: 'reply-request',
  execution: {
    id: Schema.decodeUnknownSync(executionIdSchema)('reply-run'),
    workflow: 'reply',
    correlationId: 'reply-request',
    status: 'running',
    outcome: null,
    failureKind: null,
    configurationWaitReason: null,
    canCancel: true,
    createdAtMs: 1n,
    updatedAtMs: 1n
  }
};

function mount() {
  const fixture = test.rpcHandlersTransport({
    'notes.noteWork': api.work,
    'workflows.cancelExecution': api.cancel,
    'pages.cancelTransform': api.transform
  });

  test.render(<NotePendingWork id={id} />, { wrapper: fixture.wrapper });

  return fixture;
}

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({
      work: mock.fn(),
      cancel: mock.fn(),
      transform: mock.fn()
    }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('@tanstack/react-router', () => ({
    Link: ({ children, to, ...props }: React.ComponentProps<'a'> & { to: string }) => (
      <a href={to} {...props}>
        {children}
      </a>
    )
  }));
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({
      t: (key: string, values?: { title: string }) => (values ? key + ' ' + values.title : key)
    })
  }));
  const __mockModule0 = await import('./note-pending-work');

  NotePendingWork = __mockModule0.NotePendingWork;
});

test.beforeEach(() => test.vi.resetAllMocks());
test.afterEach(() => {
  test.cleanup();
});

test.stable('stops the exact execution safely and waits for committed cancellation', async () => {
  let stopping = false;

  api.work.mockImplementation(async () => ({
    items: stopping
      ? [{ ...row, execution: { ...row.execution, status: 'cancelling', canCancel: false } }]
      : [row],
    next: null
  }));
  let resolve!: (value: unknown) => void;

  api.cancel.mockImplementation(
    () =>
      new Promise((accept) => {
        resolve = accept;
      })
  );
  mount();
  const stop = await test.screen.findByRole('button', { name: 'NoteWorkStop NoteWorkReply' });

  test.expect(api.work).toHaveBeenCalledWith({ noteId: id, limit: 20, before: undefined });
  test.fireEvent.click(stop);
  await test.waitFor(() => test.expect(stop).toBeDisabled());
  await test.waitFor(() =>
    test.expect(api.cancel).toHaveBeenCalledExactlyOnceWith({ id: row.execution.id, mode: 'safe' })
  );
  stopping = true;
  await test.act(async () => resolve({ ...row.execution, status: 'cancelling', canCancel: false }));
  test
    .expect(await test.screen.findByRole('status', { name: 'NoteWorkStopping' }))
    .toBeInTheDocument();
  test.expect(stop).toBeDisabled();
});

test.stable(
  'shows the operation and waiting state while keeping live details collapsed',
  async () => {
    api.work.mockResolvedValue({
      items: [
        {
          ...row,
          kind: 'transform',
          title: 'A long study guide title',
          execution: { ...row.execution, status: 'suspended' }
        }
      ],
      next: null
    });
    mount();
    const status = await test.screen.findByRole('status', { name: 'NoteWorkWaiting' });

    test.expect(status).toHaveTextContent('NoteWorkWaiting');
    test.expect(status).toHaveAttribute('data-state', 'waiting');
    test.expect(test.screen.getByText('NoteWorkTransform')).toBeVisible();
    test.expect(test.screen.getByText('A long study guide title')).toBeVisible();
    const summary = test.screen.getByText('NoteWorkDetails');
    const details = summary.closest('details');

    test.expect(details).not.toHaveAttribute('open');
    test.fireEvent.click(summary);
    test.expect(details).toHaveAttribute('open');
  }
);

test.stable(
  'uses domain cancellation for transforms and reconciles a lost response without replay',
  async () => {
    const transform = { ...row, kind: 'transform', title: 'Study guide' };
    let cancelled = false;

    api.work.mockImplementation(async () => ({ items: cancelled ? [] : [transform], next: null }));
    api.transform.mockImplementation(async () => {
      cancelled = true;

      throw new Error('Receipt lost');
    });
    mount();
    test.fireEvent.click(
      await test.screen.findByRole('button', { name: 'NoteWorkStop Study guide' })
    );
    await test.screen.findByText('NoteWorkEmpty');
    test.expect(api.transform).toHaveBeenCalledExactlyOnceWith({ requestId: row.requestId });
    test.expect(api.cancel).not.toHaveBeenCalled();
  }
);

test.stable('retains honest cancellation error and disables replay until refreshed', async () => {
  api.work.mockResolvedValue({ items: [row], next: null });
  api.cancel.mockRejectedValue(new Error('Offline'));
  mount();
  test.fireEvent.click(
    await test.screen.findByRole('button', { name: 'NoteWorkStop NoteWorkReply' })
  );
  test.expect(await test.screen.findByRole('alert')).toHaveTextContent('NoteWorkStopError');
  test
    .expect(test.screen.getByRole('button', { name: 'NoteWorkStop NoteWorkReply' }))
    .toBeDisabled();
  test.expect(api.cancel).toHaveBeenCalledTimes(1);
});

test.stable('shows actionable guidance for configuration waits', async () => {
  api.work.mockResolvedValue({
    items: [
      {
        ...row,
        kind: 'transform',
        execution: {
          ...row.execution,
          status: 'suspended',
          configurationWaitReason: 'model_unavailable'
        }
      }
    ],
    next: null
  });
  mount();
  test.expect(await test.screen.findByText('NoteWaitModel')).toBeVisible();
  test.expect(test.screen.getByRole('link', { name: 'Settings' })).toBeEnabled();
});
