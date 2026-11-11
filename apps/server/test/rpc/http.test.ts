/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies the web RPC adapter round-trips unary values, typed failures, bigint IDs, │
 * │ and bytes over HTTP. Closing a client scope cancels its streaming handler, and           │
 * │ disallowed origins are rejected.                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: serves unary values, typed failures and binary codecs over HTTP; cancels a    │
 * │   streaming handler when its client scope closes.                                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Starts #server/client/index, #server/platform/rpc/index against a local HTTP peer; the   │
 * │ test owns and closes that peer.                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { Effect, Fiber, Schema, Stream } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { createRpcWebHandler } from '#server/platform/rpc/index';

const Group = RpcGroup.make(
  Rpc.make('echo', { payload: { value: Schema.String }, success: Schema.String }),
  Rpc.make('wire', {
    payload: { id: Schema.BigInt, bytes: Schema.Uint8Array },
    success: Schema.Struct({ id: Schema.BigInt, bytes: Schema.Uint8Array })
  }),
  Rpc.make('fail', { error: Schema.Struct({ kind: Schema.Literal('not_found') }) }),
  Rpc.make('events', { success: Schema.Number, stream: true })
);

async function withServer(
  run: (
    url: string,
    ended: Promise<void>,
    calls: () => number,
    shutdown: () => Promise<void>
  ) => Promise<void>
) {
  let end!: () => void;
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  let calls = 0;
  const app = createRpcWebHandler({
    group: Group,
    handlers: Group.toLayer({
      echo: ({ value }) =>
        Effect.sync(() => {
          calls++;

          return value;
        }),
      wire: (value) => Effect.succeed(value),
      fail: () => Effect.fail({ kind: 'not_found' as const }),
      events: () =>
        Stream.concat(Stream.make(1), Stream.never).pipe(Stream.ensuring(Effect.sync(end)))
    })
  });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => app.handler(request)
  });

  try {
    await run(server.url.origin, ended, () => calls, app.dispose);
  } finally {
    await app.dispose();
    await server.stop(true);
  }
}

testStable('serves unary values, typed failures and binary codecs over HTTP', async () => {
  await withServer(async (url) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(Group, { baseUrl: url });

          assert.strictEqual(yield* client.echo({ value: 'hello' }), 'hello');
          const data = { id: 9007199254740993n, bytes: new Uint8Array([0, 128, 255]) };

          expect(yield* client.wire(data)).toStrictEqual(data);
          expect(yield* Effect.flip(client.fail())).toStrictEqual({ kind: 'not_found' });
        })
      )
    );
  });
});

testStable('cancels a streaming handler when its client scope closes', async () => {
  await withServer(async (url, ended) => {
    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(Group, { baseUrl: url });

          return yield* Stream.runCollect(client.events().pipe(Stream.take(1)));
        })
      )
    );

    expect(Array.from(values)).toStrictEqual([1]);
    await Promise.race([
      ended,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('stream was not cancelled')), 2000)
      )
    ]);
  });
});

testStable(
  'allows desktop origins and rejects other origins before handling requests',
  async () => {
    await withServer(async (url) => {
      const allowed = await fetch(`${url}/rpc`, {
        method: 'OPTIONS',
        headers: {
          origin: 'tauri://localhost',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type'
        }
      });

      assert.ok(allowed.headers.get('access-control-allow-origin') === 'tauri://localhost');
      const denied = await fetch(`${url}/rpc`, {
        method: 'POST',
        headers: { origin: 'https://evil.example' }
      });

      assert.strictEqual(denied.status, 403);
    });
  }
);

testStable('retries discovery on a later call without replaying the failed call', async () => {
  await withServer(async (url, _ended, calls) => {
    let discoveries = 0;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(Group, {
            baseUrl: () => {
              discoveries++;

              assert.ok(!(discoveries === 1), 'unavailable');

              return url;
            }
          });

          yield* Effect.flip(client.echo({ value: 'first' }));
          assert.strictEqual(discoveries, 1);
          assert.strictEqual(yield* client.echo({ value: 'second' }), 'second');
          assert.strictEqual(discoveries, 2);
          assert.strictEqual(calls(), 1);
        })
      )
    );
  });
});

testStable('disposes active handlers when the server shuts down', async () => {
  await withServer(async (url, ended, _calls, shutdown) => {
    let started!: () => void;
    const first = new Promise<void>((resolve) => {
      started = resolve;
    });

    function* verifyHandlerDisposal() {
      const client = yield* makeStudyClient(Group, { baseUrl: url });

      return yield* Stream.runForEach(client.events(), () => Effect.sync(started));
    }

    const fiber = Effect.runFork(Effect.scoped(Effect.gen(verifyHandlerDisposal)));

    await first;
    await shutdown();
    await ended;
    await Effect.runPromise(Fiber.interrupt(fiber));
  });
});
