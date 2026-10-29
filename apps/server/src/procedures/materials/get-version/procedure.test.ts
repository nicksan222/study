import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerTest } from '#testing/server-test';

test('getVersion returns null for a missing snapshot', async (t) => {
  const f = await createServerTest(t),
    c = f.caller.materials;

  assert.equal(await c.getVersion({ id: 999n }), null);
  await assert.rejects(c.getVersion({ id: -1n }));
});
