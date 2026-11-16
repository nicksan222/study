import { noteIdSchema, messageIdSchema, versionIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { PendingMessageWork } from './pending-message-work';

const api = test.hoisted(() => ({
  provenance: test.vi.fn(),
  executions: test.vi.fn(),
  cancel: test.vi.fn()
}));

test.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

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

let fixture: ReturnType<typeof test.rpcHandlersTransport>;

test.beforeEach(() => {
  test.vi.resetAllMocks();
  fixture = test.rpcHandlersTransport({
    'notes.replyVersion': api.provenance,
    'workflows.executions': api.executions,
    'workflows.cancelExecution': api.cancel
  });
  api.provenance.mockResolvedValue({ state: 'available', requestId: 'exact-request' });
  api.executions.mockResolvedValue({ items: [execution], next: null });
});
test.afterEach(() => {
  test.cleanup();
});

function mount() {
  test.render(<PendingMessageWork {...target} />, { wrapper: fixture.wrapper });
}

test.stable(
  'cancels the exact pending version and waits for committed stopping state',
  async () => {
    api.cancel.mockImplementation(async () => {
      api.executions.mockResolvedValue({
        items: [{ ...execution, status: 'cancelling', canCancel: false }],
        next: null
      });

      return { ...execution, status: 'cancelling', canCancel: false };
    });
    mount();
    const button = await test.screen.findByRole('button', { name: 'NoteCancel' });

    test.expect(test.screen.getByRole('status')).toHaveTextContent('NoteThinking');
    test.expect(document.querySelector('[data-slot="loading-placeholder"]')).toBeNull();

    test.fireEvent.click(button);
    await test.waitFor(() =>
      test.expect(api.cancel).toHaveBeenCalledExactlyOnceWith({ id: 'exact-run', mode: 'safe' })
    );
    await test.waitFor(() => test.expect(button).toBeDisabled());
    test.expect(api.provenance).toHaveBeenCalledWith(target);
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('status')).toHaveTextContent('NoteWorkStopping')
    );
  }
);

test.stable(
  'keeps an ambiguous cancellation disabled until an explicit status refresh',
  async () => {
    api.cancel.mockRejectedValue(new Error('Offline'));
    mount();
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteCancel' }));
    test.expect(await test.screen.findByRole('alert')).toHaveTextContent('NoteWorkStopError');
    test.expect(test.screen.getByRole('button', { name: 'NoteCancel' })).toBeDisabled();
    test.expect(api.cancel).toHaveBeenCalledTimes(1);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'LibraryRefresh' }));
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteCancel' })).toBeEnabled()
    );
    test.expect(api.cancel).toHaveBeenCalledTimes(1);
  }
);
