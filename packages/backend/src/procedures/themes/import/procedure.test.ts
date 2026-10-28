import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

const json = JSON.stringify({
  version: 1,
  id: 'custom-ocean',
  name: 'Ocean',
  colors: { primary: 'red' }
});

test('import theme', async (t) => {
  const f = await createBackendTest(t);

  await f.caller.themes.import({ json });
  const changed = JSON.stringify({
    version: 1,
    id: 'custom-ocean',
    name: 'Replacement',
    colors: { primary: 'blue' }
  });

  await assert.rejects(f.caller.themes.import({ json: changed }), { kind: 'invalid_input' });
  assert.equal((await f.caller.themes.list())[0]?.name, 'Ocean');
  await assert.rejects(f.caller.themes.import({ json: 'invalid' }));
  assert.equal((await f.caller.themes.list()).length, 7);
});
