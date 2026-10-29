import assert from 'node:assert/strict';
import { test } from 'node:test';

import { savePreferences as dbSavePreferences } from '#server/procedures/settings/preferences';
import { createServerTest } from '#testing/server-test';

test('getMaterialSettings reads the default and persisted sift preference', async (t) => {
  const f = await createServerTest(t);

  assert.equal((await f.caller.settings.getMaterialSettings()).sift, true);
  dbSavePreferences(f.store, 'material', {
    sift: false
  });
  assert.equal((await f.caller.settings.getMaterialSettings()).sift, false);
});
