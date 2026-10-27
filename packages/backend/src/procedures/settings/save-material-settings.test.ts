import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { loadPreferences as dbLoadPreferences } from './preferences.ts';
test('saveMaterialSettings stores both boolean values', async (t) => {
  const f = await fixture(t);

  await f.caller.settings.saveMaterialSettings({
    sift: false
  });
  assert.equal(dbLoadPreferences(f.store, 'material').sift, false);
  await f.caller.settings.saveMaterialSettings({
    sift: true
  });
  assert.equal(dbLoadPreferences(f.store, 'material').sift, true);
});
