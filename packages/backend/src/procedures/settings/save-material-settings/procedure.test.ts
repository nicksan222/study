import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadPreferences as dbLoadPreferences } from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';

test('saveMaterialSettings stores both boolean values', async (t) => {
  const f = await createBackendTest(t);

  await f.caller.settings.saveMaterialSettings({});
  assert.equal(dbLoadPreferences(f.store, 'material').sift, false);
  await f.caller.settings.saveMaterialSettings({
    sift: false
  });
  assert.equal(dbLoadPreferences(f.store, 'material').sift, false);
  await f.caller.settings.saveMaterialSettings({
    sift: true
  });
  assert.equal(dbLoadPreferences(f.store, 'material').sift, true);
});
