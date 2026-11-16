import { noteIdSchema, messageIdSchema, versionIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from './pending-message-work';

let PendingMessageWork: typeof __MockType0.PendingMessageWork;

let api: ReturnType<typeof createMockState>['api'];

const target = {
  noteId: Schema.decodeUnknownSync(noteIdSchema)(1n),
  messageId: Schema.decodeUnknownSync(messageIdSchema)(2n),
  versionId: Schema.decodeUnknownSync(versionIdSchema)(3n)
};

const execution = {
  id: 'exact-run',
  workflow: 'reply',
  correlationId: 'exact-request',
  status: 'running',
  outcome: null,
  failureKind: null,
  configurationWaitReason: null,
  canCancel: true,
  createdAtMs: 1n,
  updatedAtMs: 1n
};

let fixture: ReturnType<test.unit.Context['rpcHandlersTransport']>;

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({
      provenance: mock.fn(),
      executions: mock.fn(),
      cancel: mock.fn()
    }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('./pending-message-work');

  PendingMessageWork = __mockModule0.PendingMessageWork;
});

test.unit.beforeEach(({ vi, rpcHandlersTransport }) => {
  vi.resetAllMocks();
  fixture = rpcHandlersTransport({
    'notes.replyVersion': api.provenance,
    'workflows.executions': api.executions,
    'workflows.cancelExecution': api.cancel
  });
  api.provenance.mockResolvedValue({ state: 'available', requestId: 'exact-request' });
  api.executions.mockResolvedValue({ items: [execution], next: null });
});
test.unit.afterEach(({ cleanup }) => {
  cleanup();
});

function mount({ render }: Pick<test.unit.Context, 'render'>) {
  render(<PendingMessageWork {...target} />, { wrapper: fixture.wrapper });
}

test.unit.stable(
  'cancels the exact pending version and waits for committed stopping state',
  async ({ screen, expect, fireEvent, waitFor, render }) => {
    api.cancel.mockImplementation(async () => {
      api.executions.mockResolvedValue({
        items: [{ ...execution, status: 'cancelling', canCancel: false }],
        next: null
      });

      return { ...execution, status: 'cancelling', canCancel: false };
    });
    mount({ render });
    const button = await screen.findByRole('button', { name: 'NoteCancel' });

    expect(screen.getByRole('status')).toHaveTextContent('NoteThinking');
    expect(document.querySelector('[data-slot="loading-placeholder"]')).toBeNull();

    fireEvent.click(button);
    await waitFor(() =>
      expect(api.cancel).toHaveBeenCalledExactlyOnceWith({ id: 'exact-run', mode: 'safe' })
    );
    await waitFor(() => expect(button).toBeDisabled());
    expect(api.provenance).toHaveBeenCalledWith(target);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('NoteWorkStopping'));
  }
);

test.unit.stable(
  'keeps an ambiguous cancellation disabled until an explicit status refresh',
  async ({ fireEvent, screen, expect, waitFor, render }) => {
    api.cancel.mockRejectedValue(new Error('Offline'));
    mount({ render });
    fireEvent.click(await screen.findByRole('button', { name: 'NoteCancel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('NoteWorkStopError');
    expect(screen.getByRole('button', { name: 'NoteCancel' })).toBeDisabled();
    expect(api.cancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'LibraryRefresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteCancel' })).toBeEnabled());
    expect(api.cancel).toHaveBeenCalledTimes(1);
  }
);
