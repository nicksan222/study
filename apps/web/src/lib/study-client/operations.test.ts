import { act, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { runOperation } from '../effect/runtime';
import { listProjects } from './operations';

const api = vi.hoisted(() => ({ page: vi.fn(), opened: 0, closed: 0 }));

vi.mock('./client', async () => {
  const { Effect } = await import('effect');

  return {
    studyClient: Effect.acquireRelease(
      Effect.sync(() => {
        api.opened++;

        return { 'projects.projects': (input: unknown) => api.page(input) };
      }),
      () =>
        Effect.sync(() => {
          api.closed++;
        })
    )
  };
});

beforeEach(() => {
  api.opened = 0;
  api.closed = 0;
  api.page.mockReset().mockReturnValue(Effect.succeed({ items: [], next: null }));
});

it('opens RPC resources lazily and closes them after a completed operation', async () => {
  const operation = listProjects();

  expect(api.opened).toBe(0);
  expect(await runOperation(operation, new AbortController().signal)).toEqual({
    status: 'ready',
    value: []
  });
  expect(api.opened).toBe(1);
  expect(api.closed).toBe(1);
});

it('closes the RPC scope when its owner cancels an in-flight operation', async () => {
  api.page.mockReturnValue(Effect.never);
  const controller = new AbortController();
  const pending = runOperation(listProjects(), controller.signal);

  await waitFor(() => expect(api.opened).toBe(1));
  await act(async () => {
    controller.abort();
  });
  expect(await pending).toEqual({ status: 'cancelled' });
  expect(api.closed).toBe(1);
});

it('preserves serialized domain failures and releases the RPC scope on failure', async () => {
  api.page.mockReturnValue(
    Effect.fail({
      kind: 'rate_limited',
      message: 'limited',
      retryAfterMs: 500
    })
  );
  const result = await runOperation(listProjects(), new AbortController().signal);

  expect(result.status).toBe('error');

  if (result.status === 'error') {
    expect(result.error.kind).toBe('rate_limited');
    expect(result.error.retryAfterMs).toBe(500);
  }

  expect(api.closed).toBe(1);
});
