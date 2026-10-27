import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { savePreferences as dbSavePreferences } from './preferences.ts';
test('getMaterialSettings reads the default and persisted sift preference', async (t) => {
  const f = await fixture(t);

  assert.equal((await f.caller.settings.getMaterialSettings({})).sift, true);
  dbSavePreferences(f.store, 'material', {
    sift: false
  });
  assert.equal((await f.caller.settings.getMaterialSettings({})).sift, false);
});
