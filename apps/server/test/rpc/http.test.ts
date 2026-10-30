import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { test } from 'node:test';

import { Effect, Fiber, Schema, Stream } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

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
  const server = createServer(async (req, res) => {
    const abort = new AbortController();

    res.on('close', () => abort.abort());
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req);
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: body as ReadableStream | undefined,
      duplex: 'half',
      signal: abort.signal
    } as RequestInit);
    const response = await app.handler(request);

    res.writeHead(response.status, Object.fromEntries(response.headers));

    if (response.body) {
      const stream = Readable.fromWeb(response.body as NodeReadableStream);

      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } else res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  assert.ok(address && typeof address !== 'string');

  try {
    await run(`http://127.0.0.1:${address.port}`, ended, () => calls, app.dispose);
  } finally {
    await app.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test('serves unary values, typed failures and binary codecs over HTTP', async () => {
  await withServer(async (url) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(Group, { baseUrl: url });

          assert.equal(yield* client.echo({ value: 'hello' }), 'hello');
          const data = { id: 9007199254740993n, bytes: new Uint8Array([0, 128, 255]) };

          assert.deepEqual(yield* client.wire(data), data);
          assert.deepEqual(yield* Effect.flip(client.fail()), { kind: 'not_found' });
        })
      )
    );
  });
});

test('cancels a streaming handler when its client scope closes', async () => {
  await withServer(async (url, ended) => {
    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(Group, { baseUrl: url });

          return yield* Stream.runCollect(client.events().pipe(Stream.take(1)));
        })
      )
    );

    assert.deepEqual(Array.from(values), [1]);
    await Promise.race([
      ended,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('stream was not cancelled')), 2000)
      )
    ]);
  });
});

test('allows desktop origins and rejects other origins before handling requests', async () => {
  await withServer(async (url) => {
    const allowed = await fetch(`${url}/rpc`, {
      method: 'OPTIONS',
      headers: {
        origin: 'tauri://localhost',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type'
      }
    });

    assert.equal(allowed.headers.get('access-control-allow-origin'), 'tauri://localhost');
    const denied = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: { origin: 'https://evil.example' }
    });

    assert.equal(denied.status, 403);
  });
});

test('retries discovery on a later call without replaying the failed call', async () => {
  await withServer(async (url, _ended, calls) => {
    let discoveries = 0;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(Group, {
            baseUrl: () => {
              discoveries++;

              if (discoveries === 1) throw new Error('unavailable');

              return url;
            }
          });

          yield* Effect.flip(client.echo({ value: 'first' }));
          assert.equal(discoveries, 1);
          assert.equal(yield* client.echo({ value: 'second' }), 'second');
          assert.equal(discoveries, 2);
          assert.equal(calls(), 1);
        })
      )
    );
  });
});

test('disposes active handlers when the server shuts down', async () => {
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
