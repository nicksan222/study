import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerTest } from '#testing/server-test';

const json = JSON.stringify({
  version: 1,
  id: 'custom-ocean',
  name: 'Ocean',
  colors: { primary: 'red' }
});

test('select theme', async (t) => {
  const f = await createServerTest(t);

  await assert.rejects(f.caller.themes.select({ id: 'missing' }));
  await f.caller.themes.save({ json });
  await f.caller.themes.select({ id: 'custom-ocean' });
  assert.equal(await f.caller.themes.selected(), 'custom-ocean');
  await f.caller.themes.select({ id: null });
  assert.equal(await f.caller.themes.selected(), null);
});
