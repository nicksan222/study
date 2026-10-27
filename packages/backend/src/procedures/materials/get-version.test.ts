import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { materialsRouter } from './router.ts';
test('getVersion returns null for a missing snapshot', async (t) => {
  const f = await fixture(t),
    c = materialsRouter.createCaller(f.context);

  assert.equal(await c.getVersion({ id: 999n }), null);
  await assert.rejects(c.getVersion({ id: -1n }));
});
