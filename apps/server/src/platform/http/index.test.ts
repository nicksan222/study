/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises bounded HTTP page fetching and streaming transport against local peers.  │
 * │ Coverage checks redirects, size and time limits, cancellation, and typed                 │
 * │ transport/status failures.                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: HTTP transport failures preserve their private cause; HTTP redirects,         │
 * │   response size, timeout and cancellation are bounded.                                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Starts ./index.ts against a local HTTP peer; the test owns and closes that peer.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createServer } from 'node:http';

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { fetchPage as fetchPageEffect, requestBytes, streamingFetch } from './index.ts';

const fetchPage = (
  url: string,
  options: {
    maxBytes?: number;
    maxRedirects?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
) => Effect.runPromise(fetchPageEffect(url, options), { signal: options.signal });

testStable('HTTP transport failures preserve their private cause', async () => {
  await expect(fetchPage('http://127.0.0.1:0')).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof Error &&
      'kind' in error &&
      error.kind === 'transient' &&
      error.cause !== undefined
  );
});

testStable('HTTP redirects, response size, timeout and cancellation are bounded', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/page' }).end();

      return;
    }

    if (req.url === '/slow') return;

    if (req.url === '/slow-body') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');

      return;
    }

    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('hello');
      res.end('world');

      return;
    }

    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<p>hello</p>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();

    assert.ok(!(!address || typeof address === 'string'));

    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetchPage(base + '/redirect');

    assert.ok(new TextDecoder().decode(page.bytes) === '<p>hello</p>');
    assert.strictEqual(page.url, base + '/page');
    await expect(fetchPage(base + '/page', { maxBytes: 3 })).rejects.toMatchObject({
      kind: 'invalid_input'
    });
    await expect(fetchPage(base + '/stream', { maxBytes: 3 })).rejects.toMatchObject({
      kind: 'invalid_input'
    });
    await expect(fetchPage(base + '/redirect', { maxRedirects: 0 })).rejects.toMatchObject({
      kind: 'invalid_input'
    });
    await expect(fetchPage(base + '/slow', { timeoutMs: 20 })).rejects.toMatchObject({
      kind: 'transient'
    });
    await expect(fetchPage(base + '/slow-body', { timeoutMs: 20 })).rejects.toMatchObject({
      kind: 'transient'
    });
    const controller = new AbortController();

    controller.abort();
    await expect(fetchPage(base + '/page', { signal: controller.signal })).rejects.toSatisfy(
      () => true
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

testStable(
  'HTTP status failures are typed and interruption closes an in-flight request',
  async () => {
    let closed!: () => void;
    let started!: () => void;
    const closedPromise = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const server = createServer((request, response) => {
      if (request.url === '/slow') {
        request.on('close', closed);
        started();

        return;
      }

      response
        .writeHead(request.url === '/rate' ? 429 : request.url === '/server' ? 503 : 404)
        .end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    assert.ok(!(!address || typeof address === 'string'), 'missing address');

    const base = `http://127.0.0.1:${address.port}`;

    try {
      for (const [path, kind] of [
        ['/rate', 'rate_limited'],
        ['/server', 'transient'],
        ['/missing', 'invalid_input']
      ])
        await expect(fetchPage(base + path)).rejects.toMatchObject({ kind });

      const controller = new AbortController();
      const pending = fetchPage(base + '/slow', { signal: controller.signal });

      await startedPromise;
      controller.abort();
      await expect(pending).rejects.toSatisfy(() => true);
      await closedPromise;
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
);

testStable('bounded POST reads token responses and times out while reading the body', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });

    if (request.url === '/slow') response.write('{');
    else response.end('{"ok":true}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  assert.ok(!(!address || typeof address === 'string'), 'missing address');

  const base = `http://127.0.0.1:${address.port}`;

  try {
    const response = await Effect.runPromise(
      requestBytes(base, { body: 'form', timeoutMs: 1000, maxBytes: 128 })
    );

    assert.ok(new TextDecoder().decode(response.bytes) === '{"ok":true}');
    await expect(
      Effect.runPromise(
        requestBytes(base + '/slow', { body: 'form', timeoutMs: 20, maxBytes: 128 })
      )
    ).rejects.toMatchObject({ kind: 'transient' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

testStable('streaming fetch keeps its scoped request alive until cancellation', async () => {
  let closed!: () => void;
  const closedPromise = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = createServer((request, response) => {
    request.on('close', closed);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('first');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  assert.ok(!(!address || typeof address === 'string'), 'missing address');

  try {
    const response = await streamingFetch(
      `http://127.0.0.1:${address.port}`,
      {},
      { timeoutMs: 1000, maxBytes: 128 }
    );
    const reader = response.body!.getReader();

    assert.ok(new TextDecoder().decode((await reader.read()).value) === 'first');
    await reader.cancel();
    await closedPromise;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

testStable('streaming fetch enforces byte limits without a content length', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200);
    response.write('first');
    response.end('second');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  assert.ok(!(!address || typeof address === 'string'), 'missing address');

  try {
    const response = await streamingFetch(
      `http://127.0.0.1:${address.port}`,
      {},
      { timeoutMs: 1000, maxBytes: 7 }
    );

    await expect(response.text()).rejects.toMatchObject({ kind: 'transient' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

testStable('streaming fetch body deadline follows the native clock', async () => {
  const { Clock } = await import('effect');
  const { TestClock } = await import('effect/testing');
  let closed!: () => void;
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = createServer((request, response) => {
    request.on('close', closed);
    response.writeHead(200);
    response.write('first');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  assert.ok(!(!address || typeof address === 'string'), 'missing address');

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock;
        const response = yield* Effect.promise(() =>
          streamingFetch(
            `http://127.0.0.1:${address.port}`,
            {},
            { timeoutMs: 1000, maxBytes: 128, clock }
          )
        );
        const result = expect(response.text()).rejects.toMatchObject({ kind: 'transient' });

        yield* TestClock.adjust('1 second');
        yield* Effect.promise(() => result);
        yield* Effect.promise(() => disconnected);
      }).pipe(Effect.provide(TestClock.layer()))
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
