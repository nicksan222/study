import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  setPreference as dbSetPreference,
  savePreferences as dbSavePreferences
} from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';

test('getAppSettings uses defaults and exposes only public application preferences', async (t) => {
  const f = await createBackendTest(t);
  const first = await f.caller.settings.getAppSettings();

  assert.equal(first.zoomPercent, 100);
  assert.equal(first.language, 1);
  assert.equal(first.onboarded, false);
  dbSavePreferences(f.store, 'app', {
    language: 2,
    appearance: 1,
    zoomPercent: 125,
    onboarded: true
  });
  dbSetPreference(f.store, 'private.chatgpt', 'account', {
    refreshToken: 'private'
  });
  const result = await f.caller.settings.getAppSettings();

  assert.equal(result.zoomPercent, 125);
  assert.equal(result.language, 2);
  assert.equal(result.onboarded, true);
  assert.equal(JSON.stringify(result).includes('private'), false);
});
