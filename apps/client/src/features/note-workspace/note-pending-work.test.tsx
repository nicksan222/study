import { noteIdSchema } from '@study/contracts/ids';
import type { noteWorkItemSchema } from '@study/contracts/notes/work';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { NotePendingWork } from './note-pending-work';

const api = vi.hoisted(() => ({ work: vi.fn(), cancel: vi.fn(), transform: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: React.ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}));
vi.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({
    t: (key: string, values?: { title: string }) => (values ? key + ' ' + values.title : key)
  })
}));
vi.mock('#client/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'notes.noteWork': api.work,
      'workflows.cancelExecution': api.cancel,
      'pages.cancelTransform': api.transform
    })
}));

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

const clients: QueryClient[] = [];

function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  clients.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <NotePendingWork id={id} />
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
});

testStable(
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
    fireEvent.click(await screen.findByRole('button', { name: 'NoteWorkStop Study guide' }));
    await screen.findByText('NoteWorkEmpty');
    expect(api.transform).toHaveBeenCalledExactlyOnceWith({ requestId: row.requestId });
    expect(api.cancel).not.toHaveBeenCalled();
  }
);

testStable('retains honest cancellation error and disables replay until refreshed', async () => {
  api.work.mockResolvedValue({ items: [row], next: null });
  api.cancel.mockRejectedValue(new Error('Offline'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'NoteWorkStop NoteWorkReply' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('NoteWorkStopError');
  expect(screen.getByRole('button', { name: 'NoteWorkStop NoteWorkReply' })).toBeDisabled();
  expect(api.cancel).toHaveBeenCalledTimes(1);
});

testStable('shows actionable guidance for configuration waits', async () => {
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
  expect(await screen.findByText('NoteWaitModel')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Settings' })).toBeEnabled();
});
