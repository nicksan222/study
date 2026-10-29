import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

const json = JSON.stringify({
  version: 1,
  id: 'custom-ocean',
  name: 'Ocean',
  colors: { primary: 'red' }
});

test('list theme', async (t) => {
  const f = await createBackendTest(t);

  assert.equal((await f.caller.themes.list()).length, 6);
  await f.caller.themes.save({ json });
  assert.ok((await f.caller.themes.list()).some((theme) => theme.id === 'custom-ocean'));
});
