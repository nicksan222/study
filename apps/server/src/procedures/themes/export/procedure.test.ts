import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServerTest } from '#testing/server-test';

const json = JSON.stringify({
  version: 1,
  id: 'custom-ocean',
  name: 'Ocean',
  colors: { primary: 'red' }
});

test('export theme', async (t) => {
  const f = await createServerTest(t);

  await f.caller.themes.save({ json });
  assert.deepEqual(
    JSON.parse(await f.caller.themes.export({ id: 'custom-ocean' })),
    JSON.parse(json)
  );
  await assert.rejects(f.caller.themes.export({ id: 'missing' }));
});
