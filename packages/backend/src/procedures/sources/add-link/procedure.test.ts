import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';
test('addLink stores a validated URL as a link source', async (t) => {
  const client = (await createBackendTest(t)).caller;
  const source = await client.sources.addLink({
    url: 'https://example.com/page'
  });

  assert.equal(source.kind, 'link');
  assert.equal(source.name, 'https://example.com/page');
});
test('addLink rejects credentials and non-web protocols', async (t) => {
  const client = (await createBackendTest(t)).caller;

  await assert.rejects(
    client.sources.addLink({
      url: 'https://user:pass@example.com'
    })
  );
  await assert.rejects(
    client.sources.addLink({
      url: 'file:///tmp/a'
    })
  );
});
