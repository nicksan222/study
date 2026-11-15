import { noteIdSchema, messageIdSchema, versionIdSchema } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { PendingMessageWork } from './pending-message-work';

const api = vi.hoisted(() => ({ provenance: vi.fn(), executions: vi.fn(), cancel: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

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

let fixture: ReturnType<typeof rpcHandlersTransport>;

beforeEach(() => {
  vi.resetAllMocks();
  fixture = rpcHandlersTransport({
    'notes.replyVersion': api.provenance,
    'workflows.executions': api.executions,
    'workflows.cancelExecution': api.cancel
  });
  api.provenance.mockResolvedValue({ state: 'available', requestId: 'exact-request' });
  api.executions.mockResolvedValue({ items: [execution], next: null });
});
afterEach(() => {
  cleanup();
});

function mount() {
  render(<PendingMessageWork {...target} />, { wrapper: fixture.wrapper });
}

testStable('cancels the exact pending version and waits for committed stopping state', async () => {
  api.cancel.mockImplementation(async () => {
    api.executions.mockResolvedValue({
      items: [{ ...execution, status: 'cancelling', canCancel: false }],
      next: null
    });

    return { ...execution, status: 'cancelling', canCancel: false };
  });
  mount();
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
});

testStable(
  'keeps an ambiguous cancellation disabled until an explicit status refresh',
  async () => {
    api.cancel.mockRejectedValue(new Error('Offline'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'NoteCancel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('NoteWorkStopError');
    expect(screen.getByRole('button', { name: 'NoteCancel' })).toBeDisabled();
    expect(api.cancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'LibraryRefresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteCancel' })).toBeEnabled());
    expect(api.cancel).toHaveBeenCalledTimes(1);
  }
);
