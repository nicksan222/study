import assert from 'node:assert/strict';
import { test } from 'node:test';

import { savePreferences as dbSavePreferences } from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';

test('getMaterialSettings reads the default and persisted sift preference', async (t) => {
  const f = await createBackendTest(t);

  assert.equal((await f.caller.settings.getMaterialSettings()).sift, true);
  dbSavePreferences(f.store, 'material', {
    sift: false
  });
  assert.equal((await f.caller.settings.getMaterialSettings()).sift, false);
});
