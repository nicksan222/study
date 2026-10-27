import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { fetchPage } from './fetch.ts';

test('HTTP redirects, response size, timeout and cancellation are bounded', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/page' }).end();

      return;
    }

    if (req.url === '/slow') return;

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
    await assert.rejects(fetchPage(base + '/page', { maxBytes: 3 }), {
      kind: 'invalid_input'
    });
    await assert.rejects(fetchPage(base + '/redirect', { maxRedirects: 0 }), {
      kind: 'invalid_input'
    });
    await assert.rejects(fetchPage(base + '/slow', { timeoutMs: 20 }), {
      kind: 'transient'
    });
    const controller = new AbortController();

    controller.abort();
    await assert.rejects(fetchPage(base + '/page', { signal: controller.signal }), {
      kind: 'cancelled'
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
