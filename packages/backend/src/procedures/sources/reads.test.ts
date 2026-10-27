import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';
test('reads reports supported readers and unsupported source kinds', async (t) => {
  const f = await fixture(t);

  assert.equal(
    (
      await f.caller.sources.reads({
        kind: 'text',
        mime: 'text/plain'
      })
    ).value,
    true
  );
  assert.equal(
    (
      await f.caller.sources.reads({
        kind: 'other',
        mime: 'application/octet-stream'
      })
    ).value,
    false
  );
  await assert.rejects(
    f.caller.sources.reads({
      kind: 'unspecified',
      mime: ''
    } as never),
    {
      kind: 'invalid_input'
    }
  );
});
