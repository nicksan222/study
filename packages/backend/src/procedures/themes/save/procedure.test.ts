import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

const json = JSON.stringify({
  version: 1,
  id: 'custom-ocean',
  name: 'Ocean',
  colors: { primary: 'red' }
});

test('save theme', async (t) => {
  const f = await createBackendTest(t);

  await f.caller.themes.save({ json });
  await f.caller.themes.save({ json: json.replace('Ocean', 'New') });
  assert.equal(
    (await f.caller.themes.list()).find((theme) => theme.id === 'custom-ocean')?.name,
    'New'
  );
});
