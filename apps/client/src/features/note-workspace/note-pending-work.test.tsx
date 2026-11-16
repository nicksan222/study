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

function mount({
  rpcHandlersTransport,
  render
}: Pick<test.Context, 'rpcHandlersTransport' | 'render'>) {
  const fixture = rpcHandlersTransport({
    'notes.noteWork': api.work,
    'workflows.cancelExecution': api.cancel,
    'pages.cancelTransform': api.transform
  });

  render(<NotePendingWork id={id} />, { wrapper: fixture.wrapper });

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

test.beforeEach(({ vi }) => vi.resetAllMocks());
test.afterEach(({ cleanup }) => {
  cleanup();
});

test.stable(
  'stops the exact execution safely and waits for committed cancellation',
  async ({ screen, expect, fireEvent, waitFor, act, rpcHandlersTransport, render }) => {
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
    mount({ rpcHandlersTransport, render });
    const stop = await screen.findByRole('button', { name: 'NoteWorkStop NoteWorkReply' });

    expect(api.work).toHaveBeenCalledWith({ noteId: id, limit: 20, before: undefined });
    fireEvent.click(stop);
    await waitFor(() => expect(stop).toBeDisabled());
    await waitFor(() =>
      expect(api.cancel).toHaveBeenCalledExactlyOnceWith({ id: row.execution.id, mode: 'safe' })
    );
    stopping = true;
    await act(async () => resolve({ ...row.execution, status: 'cancelling', canCancel: false }));
    expect(await screen.findByRole('status', { name: 'NoteWorkStopping' })).toBeInTheDocument();
    expect(stop).toBeDisabled();
  }
);

test.stable(
  'shows the operation and waiting state while keeping live details collapsed',
  async ({ screen, expect, fireEvent, rpcHandlersTransport, render }) => {
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
    mount({ rpcHandlersTransport, render });
    const status = await screen.findByRole('status', { name: 'NoteWorkWaiting' });

    expect(status).toHaveTextContent('NoteWorkWaiting');
    expect(status).toHaveAttribute('data-state', 'waiting');
    expect(screen.getByText('NoteWorkTransform')).toBeVisible();
    expect(screen.getByText('A long study guide title')).toBeVisible();
    const summary = screen.getByText('NoteWorkDetails');
    const details = summary.closest('details');

    expect(details).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
  }
);

test.stable(
  'uses domain cancellation for transforms and reconciles a lost response without replay',
  async ({ fireEvent, screen, expect, rpcHandlersTransport, render }) => {
    const transform = { ...row, kind: 'transform', title: 'Study guide' };
    let cancelled = false;

    api.work.mockImplementation(async () => ({ items: cancelled ? [] : [transform], next: null }));
    api.transform.mockImplementation(async () => {
      cancelled = true;

      throw new Error('Receipt lost');
    });
    mount({ rpcHandlersTransport, render });
    fireEvent.click(await screen.findByRole('button', { name: 'NoteWorkStop Study guide' }));
    await screen.findByText('NoteWorkEmpty');
    expect(api.transform).toHaveBeenCalledExactlyOnceWith({ requestId: row.requestId });
    expect(api.cancel).not.toHaveBeenCalled();
  }
);

test.stable(
  'retains honest cancellation error and disables replay until refreshed',
  async ({ fireEvent, screen, expect, rpcHandlersTransport, render }) => {
    api.work.mockResolvedValue({ items: [row], next: null });
    api.cancel.mockRejectedValue(new Error('Offline'));
    mount({ rpcHandlersTransport, render });
    fireEvent.click(await screen.findByRole('button', { name: 'NoteWorkStop NoteWorkReply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('NoteWorkStopError');
    expect(screen.getByRole('button', { name: 'NoteWorkStop NoteWorkReply' })).toBeDisabled();
    expect(api.cancel).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'shows actionable guidance for configuration waits',
  async ({ expect, screen, rpcHandlersTransport, render }) => {
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
    mount({ rpcHandlersTransport, render });
    expect(await screen.findByText('NoteWaitModel')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeEnabled();
  }
);
