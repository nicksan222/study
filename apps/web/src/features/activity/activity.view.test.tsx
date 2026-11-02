import { StudyError } from '@study/contracts/errors';
import { executionSchema } from '@study/contracts/workflows/schemas';
import { catalogs } from '@study/localization';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { LanguageProvider } from '../../lib/i18n';
import type { StudyClient } from '../../lib/study-client/client';
import { Activity } from './activity';

const rpc = vi.hoisted(() => ({
  'workflows.executions': vi.fn<StudyClient['workflows.executions']>(),
  'workflows.execution': vi.fn<StudyClient['workflows.execution']>(),
  'workflows.cancelExecution': vi.fn<StudyClient['workflows.cancelExecution']>()
}));

vi.mock('../../lib/study-client/client', async () => {
  const { Effect } = await import('effect');

  return { studyClient: Effect.succeed(rpc) };
});

const t = catalogs.english;

function execution(id: string, workflow: string) {
  return Schema.decodeUnknownSync(executionSchema)({
    id,
    workflow,
    correlationId: 'context',
    status: 'running',
    outcome: null,
    failureKind: null,
    canCancel: true,
    createdAtMs: 9007199254740993n,
    updatedAtMs: 9007199254740993n
  });
}

const a = execution('run-z', 'source-ingestion');

const b = execution('run-a', 'unrecognized-task');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider locale="english">
        <Activity />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

function row(name: string) {
  return screen.getByRole('button', { name: new RegExp(name) });
}

beforeEach(() => {
  vi.resetAllMocks();
  rpc['workflows.executions'].mockReturnValue(Effect.succeed({ items: [a, b], next: null }));
  rpc['workflows.execution'].mockImplementation(({ id }) => Effect.succeed(id === a.id ? a : b));
});
afterEach(() => {
  vi.useRealTimers();
});

it('passes the full tied-timestamp cursor and preserves authoritative page order', async () => {
  const cursor = { id: b.id, createdAtMs: 9007199254740993n };
  const older = execution('older', 'conversation-reply');

  rpc['workflows.executions'].mockImplementation(({ before }) =>
    Effect.succeed(before ? { items: [older], next: null } : { items: [a, b], next: cursor })
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: t['collections.more'] }));
  await screen.findByRole('button', { name: new RegExp(t['workspace.task.conversation-reply']) });
  expect(rpc['workflows.executions']).toHaveBeenNthCalledWith(1, { limit: 20, before: undefined });
  expect(rpc['workflows.executions']).toHaveBeenNthCalledWith(2, {
    limit: 20,
    before: { id: b.id, createdAtMs: 9007199254740993n }
  });
  const rows = within(screen.getByRole('list')).getAllByRole('listitem');

  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent(t['workspace.task.source-ingestion']);
  expect(rows[1]).toHaveTextContent(t['workspace.task.other']);
  expect(rows[2]).toHaveTextContent(t['workspace.task.conversation-reply']);
  expect(screen.queryByRole('button', { name: t['collections.more'] })).toBeNull();
});

it('uses friendly known names and a generic unknown name while retaining raw workflow identity in Details', async () => {
  mount();
  await screen.findByRole('button', { name: new RegExp(t['workspace.task.source-ingestion']) });
  expect(row(t['workspace.task.other'])).toBeInTheDocument();
  expect(screen.queryByText('source-ingestion')).toBeNull();
  fireEvent.click(row(t['workspace.task.source-ingestion']));
  const summary = await screen.findByText(t['workspace.details']);
  const details = summary.closest('details')!;

  expect(details).not.toHaveAttribute('open');
  fireEvent.click(summary);
  expect(within(details).getByText('source-ingestion')).toBeInTheDocument();
  expect(within(details).getByText(a.id)).toBeInTheDocument();
  fireEvent.click(row(t['workspace.task.other']));
  await screen.findByText(t['workspace.details']);
  expect(screen.getByText('unrecognized-task').closest('details')).toBeInTheDocument();
});

it('keeps cancellation bound to A when B is selected and excludes a second action until reconciliation settles', async () => {
  const response = deferred<typeof a>();
  const reconciliation = deferred<typeof b>();

  rpc['workflows.cancelExecution'].mockReturnValue(Effect.promise(() => response.promise));
  mount();
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(t['workspace.task.source-ingestion']) })
  );
  fireEvent.click(await screen.findByRole('button', { name: t['collections.cancel'] }));
  await waitFor(() => expect(rpc['workflows.cancelExecution']).toHaveBeenCalledTimes(1));
  fireEvent.click(row(t['workspace.task.other']));
  const cancelB = await screen.findByRole('button', { name: t['collections.cancel'] });

  expect(cancelB).toBeDisabled();
  fireEvent.click(cancelB);
  const detailCalls = rpc['workflows.execution'].mock.calls.length;

  rpc['workflows.execution'].mockReturnValue(Effect.promise(() => reconciliation.promise));
  await act(async () => {
    response.resolve({ ...a, status: 'cancelling', canCancel: false });
    await response.promise;
  });
  await waitFor(() =>
    expect(rpc['workflows.execution'].mock.calls.length).toBeGreaterThan(detailCalls)
  );
  expect(rpc['workflows.execution']).toHaveBeenLastCalledWith({ id: b.id });
  expect(screen.getByRole('button', { name: t['collections.cancel'] })).toBeDisabled();
  await act(async () => {
    reconciliation.resolve({ ...b, status: 'completed', canCancel: false, outcome: 'success' });
    await reconciliation.promise;
  });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: t['collections.cancel'] })).toBeNull()
  );
  expect(row(t['workspace.task.other'])).toHaveAttribute('aria-expanded', 'true');
  expect(rpc['workflows.cancelExecution']).toHaveBeenCalledExactlyOnceWith({
    id: a.id,
    mode: 'safe'
  });
});

it('warns on a lost cancellation response and reconciles committed state without replay', async () => {
  let cancelled = false;

  rpc['workflows.execution'].mockImplementation(() =>
    Effect.succeed(cancelled ? { ...a, status: 'cancelled' as const, canCancel: false } : a)
  );
  rpc['workflows.executions'].mockImplementation(() =>
    Effect.succeed({
      items: [cancelled ? { ...a, status: 'cancelled' as const, canCancel: false } : a],
      next: null
    })
  );
  rpc['workflows.cancelExecution'].mockImplementation(() =>
    Effect.sync(() => {
      cancelled = true;
    }).pipe(Effect.flatMap(() => Effect.fail(new StudyError('internal', 'response lost'))))
  );
  mount();
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(t['workspace.task.source-ingestion']) })
  );
  fireEvent.click(await screen.findByRole('button', { name: t['collections.cancel'] }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent(t['workspace.cancelError']);
  await waitFor(() =>
    expect(row(t['workspace.task.source-ingestion'])).toHaveTextContent(
      t['workspace.state.cancelled']
    )
  );
  expect(screen.queryByRole('button', { name: t['collections.cancel'] })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t['collections.retry'] }));
  await waitFor(() => expect(rpc['workflows.executions'].mock.calls.length).toBeGreaterThan(2));
  expect(rpc['workflows.cancelExecution']).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent(t['workspace.cancelError']);
});

it('polls both list and selected detail to recover a missed status hint', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  mount();
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(t['workspace.task.source-ingestion']) })
  );
  await screen.findByRole('button', { name: t['collections.cancel'] });
  const listCalls = rpc['workflows.executions'].mock.calls.length;
  const detailCalls = rpc['workflows.execution'].mock.calls.length;

  rpc['workflows.executions'].mockReturnValue(
    Effect.succeed({
      items: [
        {
          ...a,
          status: 'completed',
          outcome: 'failure',
          failureKind: 'internal',
          canCancel: false
        }
      ],
      next: null
    })
  );
  rpc['workflows.execution'].mockReturnValue(
    Effect.succeed({
      ...a,
      status: 'completed',
      outcome: 'failure',
      failureKind: 'internal',
      canCancel: false
    })
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await waitFor(() =>
    expect(row(t['workspace.task.source-ingestion'])).toHaveTextContent(
      t['workspace.state.failure']
    )
  );
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: t['collections.cancel'] })).toBeNull()
  );
  expect(rpc['workflows.executions'].mock.calls.length).toBeGreaterThan(listCalls);
  expect(rpc['workflows.execution'].mock.calls.length).toBeGreaterThan(detailCalls);
  expect(rpc['workflows.cancelExecution']).not.toHaveBeenCalled();
});

it('withholds cancellation when canonical detail disallows it despite a stale running row', async () => {
  rpc['workflows.execution'].mockReturnValue(
    Effect.succeed({ ...a, status: 'completed', canCancel: false, outcome: 'success' })
  );
  mount();
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(t['workspace.task.source-ingestion']) })
  );
  await screen.findByText(t['workspace.details']);
  expect(screen.queryByRole('button', { name: t['collections.cancel'] })).toBeNull();
  expect(rpc['workflows.cancelExecution']).not.toHaveBeenCalled();
});

it('retries failed selected detail with a fresh exact read', async () => {
  rpc['workflows.execution'].mockReturnValueOnce(
    Effect.fail(new StudyError('internal', 'offline'))
  );
  mount();
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(t['workspace.task.source-ingestion']) })
  );
  const alert = await screen.findByRole('alert');

  expect(alert).toHaveTextContent(t['collections.readError']);
  const reads = rpc['workflows.execution'].mock.calls.length;

  fireEvent.click(within(alert).getByRole('button', { name: t['collections.retry'] }));
  await screen.findByText(t['workspace.details']);
  expect(rpc['workflows.execution']).toHaveBeenCalledTimes(reads + 1);
  expect(rpc['workflows.execution']).toHaveBeenLastCalledWith({ id: a.id });
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['auth', 'not_found', 'rate_limited', null] as const)(
  'explains a failed task with actionable guidance for %s',
  async (failureKind) => {
    const failed = {
      ...a,
      status: 'completed' as const,
      outcome: 'failure' as const,
      failureKind,
      canCancel: false
    };

    rpc['workflows.executions'].mockReturnValue(Effect.succeed({ items: [failed], next: null }));
    rpc['workflows.execution'].mockReturnValue(Effect.succeed(failed));
    mount();
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(t['workspace.task.source-ingestion']) })
    );
    expect(
      await screen.findByText(t[`workspace.failure.${failureKind ?? 'internal'}`])
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: t['collections.cancel'] })).toBeNull();
  }
);
