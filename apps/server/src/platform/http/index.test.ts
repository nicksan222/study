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
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;

      if (path === '/redirect')
        return new Response(null, { status: 302, headers: { location: '/page' } });

      if (path === '/slow')
        return new Promise<Response>((resolve) =>
          req.signal.addEventListener('abort', () => resolve(new Response(null)), { once: true })
        );

      if (path === '/slow-body')
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('partial'));
            }
          }),
          { headers: { 'content-type': 'text/plain' } }
        );

      if (path === '/stream')
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('hello'));
              controller.enqueue(new TextEncoder().encode('world'));
              controller.close();
            }
          }),
          { headers: { 'content-type': 'text/plain' } }
        );

      return new Response('<p>hello</p>', { headers: { 'content-type': 'text/html' } });
    }
  });

  try {
    assert.ok(server.port);
    const base = server.url.origin;
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
    await server.stop(true);
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
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;

        if (path === '/slow') {
          request.signal.addEventListener('abort', closed, { once: true });
          started();

          return new Promise<Response>((resolve) =>
            request.signal.addEventListener('abort', () => resolve(new Response(null)), {
              once: true
            })
          );
        }

        return new Response(null, {
          status: path === '/rate' ? 429 : path === '/server' ? 503 : 404
        });
      }
    });

    assert.ok(server.port, 'missing address');
    const base = server.url.origin;

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
      await server.stop(true);
    }
  }
);

testStable('bounded POST reads token responses and times out while reading the body', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/slow')
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
            }
          }),
          { headers: { 'content-type': 'application/json' } }
        );

      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    }
  });

  assert.ok(server.port, 'missing address');
  const base = server.url.origin;

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
    await server.stop(true);
  }
});

testStable('streaming fetch keeps its scoped request alive until cancellation', async () => {
  let closed!: () => void;
  const closedPromise = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      request.signal.addEventListener('abort', closed, { once: true });

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first'));
          }
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    }
  });

  assert.ok(server.port, 'missing address');

  try {
    const response = await streamingFetch(
      server.url.origin,
      {},
      { timeoutMs: 1000, maxBytes: 128 }
    );
    const reader = response.body!.getReader();

    assert.ok(new TextDecoder().decode((await reader.read()).value) === 'first');
    await reader.cancel();
    await closedPromise;
  } finally {
    await server.stop(true);
  }
});

testStable('streaming fetch enforces byte limits without a content length', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first'));
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode('second'));
              controller.close();
            }, 10);
          }
        })
      );
    }
  });

  assert.ok(server.port, 'missing address');

  try {
    const response = await streamingFetch(server.url.origin, {}, { timeoutMs: 1000, maxBytes: 7 });

    await expect(response.text()).rejects.toMatchObject({ kind: 'transient' });
  } finally {
    await server.stop(true);
  }
});

testStable('streaming fetch body deadline follows the native clock', async () => {
  const { Clock } = await import('effect');
  const { TestClock } = await import('effect/testing');
  let closed!: () => void;
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      request.signal.addEventListener('abort', closed, { once: true });

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first'));
          }
        })
      );
    }
  });

  assert.ok(server.port, 'missing address');

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock;
        const response = yield* Effect.promise(() =>
          streamingFetch(server.url.origin, {}, { timeoutMs: 1000, maxBytes: 128, clock })
        );
        const result = (async () => {
          await expect(response.text()).rejects.toMatchObject({ kind: 'transient' });
        })();

        yield* TestClock.adjust('1 second');
        yield* Effect.promise(() => result);
        yield* Effect.promise(() => disconnected);
      }).pipe(Effect.provide(TestClock.layer()))
    );
  } finally {
    await server.stop(true);
  }
});
