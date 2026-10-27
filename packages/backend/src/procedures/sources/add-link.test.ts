import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';
test('addLink stores a validated URL as a link source', async (t) => {
  const f = await fixture(t);
  const source = await f.caller.sources.addLink({
    url: 'https://example.com/page'
  });

  assert.equal(source.kind, 'link');
  assert.equal(source.name, 'https://example.com/page');
});
test('addLink rejects credentials and non-web protocols', async (t) => {
  const f = await fixture(t);

  await assert.rejects(
    f.caller.sources.addLink({
      url: 'https://user:pass@example.com'
    })
  );
  await assert.rejects(
    f.caller.sources.addLink({
      url: 'file:///tmp/a'
    })
  );
});
