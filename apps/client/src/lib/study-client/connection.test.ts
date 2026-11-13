import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { HttpClientError } from 'effect/http';
import { RpcClientError } from 'effect/rpc';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { createServerConnection, observeConnectionError, serverConnection } from './connection';
import { request } from './request';

const api = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('./client', async () => {
  const { Effect } = await import('effect');

  return { studyClient: Effect.succeed({ 'system.health': () => api.read() }) };
});

const transportError = () =>
  new RpcClientError.RpcClientError({
    reason: new HttpClientError.HttpClientErrorSchema({ kind: 'TransportError' })
  });

beforeEach(() => {
  serverConnection.recovered(serverConnection.snapshot().revision);
  api.read.mockReset();
});

testStable('ignores stale health responses and coalesces repeated outages', () => {
  const connection = createServerConnection();
  const listener = vi.fn();
  const stop = connection.subscribe(listener);
  const old = connection.snapshot().revision;

  connection.disconnected();
  connection.disconnected();
  connection.recovered(old);
  expect(connection.snapshot().connected).toBe(false);
  expect(listener).toHaveBeenCalledOnce();
  connection.recovered(connection.snapshot().revision);
  expect(connection.snapshot().connected).toBe(true);
  stop();
  connection.disconnected();
  expect(listener).toHaveBeenCalledTimes(2);
});

testStable(
  'RPC transport failures reach the global state while domain failures do not',
  async () => {
    api.read.mockReturnValueOnce(Effect.fail(new StudyError('transient', 'Provider unavailable')));
    await expect(request((client) => client['system.health']({}))).rejects.toMatchObject({
      kind: 'transient'
    });
    expect(serverConnection.snapshot().connected).toBe(true);
    api.read.mockReturnValueOnce(Effect.fail(transportError()));
    await expect(request((client) => client['system.health']({}))).rejects.toMatchObject({
      kind: 'transient'
    });
    expect(serverConnection.snapshot().connected).toBe(false);
  }
);

testStable(
  'aborted requests and invalid client input do not report an endpoint outage',
  async () => {
    const controller = new AbortController();

    controller.abort();
    await expect(
      request((client) => client['system.health']({}), controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    observeConnectionError(
      new RpcClientError.RpcClientError({
        reason: new HttpClientError.HttpClientErrorSchema({ kind: 'EncodeError' })
      })
    );
    expect(serverConnection.snapshot().connected).toBe(true);
  }
);
