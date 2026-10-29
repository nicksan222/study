import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerTest } from '#testing/server-test';
test('reads reports supported readers and unsupported source kinds', async (t) => {
  const client = (await createServerTest(t)).caller;

  assert.equal(
    (
      await client.sources.reads({
        kind: 'text',
        mime: 'text/plain'
      })
    ).value,
    true
  );
  assert.equal(
    (
      await client.sources.reads({
        kind: 'other',
        mime: 'application/octet-stream'
      })
    ).value,
    false
  );
  await assert.rejects(
    client.sources.reads({
      kind: 'unspecified',
      mime: ''
    } as never),
    {
      kind: 'invalid_input'
    }
  );
});
