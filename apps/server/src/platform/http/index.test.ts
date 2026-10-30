import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { Effect } from 'effect';

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

test('HTTP transport failures preserve their private cause', async () => {
  await assert.rejects(
    fetchPage('http://127.0.0.1:0'),
    (error: unknown) =>
      error instanceof Error &&
      'kind' in error &&
      error.kind === 'transient' &&
      error.cause !== undefined
  );
});

test('HTTP redirects, response size, timeout and cancellation are bounded', async () => {
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

    if (!address || typeof address === 'string') throw new Error();

    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetchPage(base + '/redirect');

    assert.equal(new TextDecoder().decode(page.bytes), '<p>hello</p>');
    assert.equal(page.url, base + '/page');
    await assert.rejects(fetchPage(base + '/page', { maxBytes: 3 }), {
      kind: 'invalid_input'
    });
    await assert.rejects(fetchPage(base + '/stream', { maxBytes: 3 }), { kind: 'invalid_input' });
    await assert.rejects(fetchPage(base + '/redirect', { maxRedirects: 0 }), {
      kind: 'invalid_input'
    });
    await assert.rejects(fetchPage(base + '/slow', { timeoutMs: 20 }), {
      kind: 'transient'
    });
    await assert.rejects(fetchPage(base + '/slow-body', { timeoutMs: 20 }), { kind: 'transient' });
    const controller = new AbortController();

    controller.abort();
    await assert.rejects(fetchPage(base + '/page', { signal: controller.signal }));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP status failures are typed and interruption closes an in-flight request', async () => {
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

    response.writeHead(request.url === '/rate' ? 429 : request.url === '/server' ? 503 : 404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('missing address');

  const base = `http://127.0.0.1:${address.port}`;

  try {
    for (const [path, kind] of [
      ['/rate', 'rate_limited'],
      ['/server', 'transient'],
      ['/missing', 'invalid_input']
    ])
      await assert.rejects(fetchPage(base + path), { kind });

    const controller = new AbortController();
    const pending = fetchPage(base + '/slow', { signal: controller.signal });

    await startedPromise;
    controller.abort();
    await assert.rejects(pending);
    await closedPromise;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('bounded POST reads token responses and times out while reading the body', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });

    if (request.url === '/slow') response.write('{');
    else response.end('{"ok":true}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('missing address');

  const base = `http://127.0.0.1:${address.port}`;

  try {
    const response = await Effect.runPromise(
      requestBytes(base, { body: 'form', timeoutMs: 1000, maxBytes: 128 })
    );

    assert.equal(new TextDecoder().decode(response.bytes), '{"ok":true}');
    await assert.rejects(
      Effect.runPromise(
        requestBytes(base + '/slow', { body: 'form', timeoutMs: 20, maxBytes: 128 })
      ),
      { kind: 'transient' }
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('streaming fetch keeps its scoped request alive until cancellation', async () => {
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

  if (!address || typeof address === 'string') throw new Error('missing address');

  try {
    const response = await streamingFetch(
      `http://127.0.0.1:${address.port}`,
      {},
      { timeoutMs: 1000, maxBytes: 128 }
    );
    const reader = response.body!.getReader();

    assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
    await reader.cancel();
    await closedPromise;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('streaming fetch enforces byte limits without a content length', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200);
    response.write('first');
    response.end('second');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('missing address');

  try {
    const response = await streamingFetch(
      `http://127.0.0.1:${address.port}`,
      {},
      { timeoutMs: 1000, maxBytes: 7 }
    );

    await assert.rejects(response.text(), { kind: 'transient' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('streaming fetch body deadline follows the native clock', async () => {
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

  if (!address || typeof address === 'string') throw new Error('missing address');

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
        const result = assert.rejects(response.text(), { kind: 'transient' });

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
