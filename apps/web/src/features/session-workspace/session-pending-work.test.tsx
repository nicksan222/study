import type { sessionWorkItemSchema } from '@study/contracts/conversations/work';
import { sessionIdSchema } from '@study/contracts/ids';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { SessionPendingWork } from './session-pending-work';

const api = vi.hoisted(() => ({ work: vi.fn(), cancel: vi.fn(), transform: vi.fn() }));

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({
    t: (key: string, values?: { title: string }) => (values ? key + ' ' + values.title : key)
  })
}));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'conversations.sessionWork': api.work,
      'workflows.cancelExecution': api.cancel,
      'documents.cancelTransform': api.transform
    })
}));

const id = Schema.decodeUnknownSync(sessionIdSchema)(1n);

const row: typeof sessionWorkItemSchema.Type = {
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
    canCancel: true,
    createdAtMs: 1n,
    updatedAtMs: 1n
  }
};

const clients: QueryClient[] = [];

function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  clients.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <SessionPendingWork id={id} />
    </QueryClientProvider>
  );

  return cache;
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((cache) => cache.clear());
});

testStable('stops the exact execution safely and waits for committed cancellation', async () => {
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
  const stop = await screen.findByRole('button', { name: 'SessionWorkStop SessionWorkReply' });

  expect(api.work).toHaveBeenCalledWith({ sessionId: id, limit: 20, before: undefined });
  fireEvent.click(stop);
  await waitFor(() => expect(stop).toBeDisabled());
  await waitFor(() =>
    expect(api.cancel).toHaveBeenCalledExactlyOnceWith({ id: row.execution.id, mode: 'safe' })
  );
  stopping = true;
  await act(async () => resolve({ ...row.execution, status: 'cancelling', canCancel: false }));
  expect(await screen.findByText('SessionWorkStopping')).toBeVisible();
  expect(stop).toBeDisabled();
});

testStable(
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
    fireEvent.click(await screen.findByRole('button', { name: 'SessionWorkStop Study guide' }));
    await screen.findByText('SessionWorkEmpty');
    expect(api.transform).toHaveBeenCalledExactlyOnceWith({ requestId: row.requestId });
    expect(api.cancel).not.toHaveBeenCalled();
  }
);

testStable('retains honest cancellation error and disables replay until refreshed', async () => {
  api.work.mockResolvedValue({ items: [row], next: null });
  api.cancel.mockRejectedValue(new Error('Offline'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'SessionWorkStop SessionWorkReply' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('SessionWorkStopError');
  expect(screen.getByRole('button', { name: 'SessionWorkStop SessionWorkReply' })).toBeDisabled();
  expect(api.cancel).toHaveBeenCalledTimes(1);
});
