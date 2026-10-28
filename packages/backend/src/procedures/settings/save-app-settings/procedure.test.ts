import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadPreferences as dbLoadPreferences } from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';

test('saveAppSettings persists bilingual preferences and rejects invalid settings atomically', async (t) => {
  const f = await createBackendTest(t);
  const valid = {
    language: 2,
    appearance: 1,
    zoomPercent: 125,
    onboarded: true
  } as const;

  await f.caller.settings.saveAppSettings(valid);
  assert.equal(dbLoadPreferences(f.store, 'app').zoomPercent, 125);

  const invalidSettings = (key: 'language' | 'appearance' | 'zoomPercent', value: number) => {
    const settings = { ...valid };

    Object.defineProperty(settings, key, { value });

    return settings;
  };

  for (const settings of [
    invalidSettings('language', 0),
    invalidSettings('appearance', 0),
    invalidSettings('zoomPercent', 49),
    invalidSettings('zoomPercent', 201)
  ])
    await assert.rejects(f.caller.settings.saveAppSettings(settings), {
      kind: 'invalid_input'
    });

  assert.equal(dbLoadPreferences(f.store, 'app').zoomPercent, 125);
});
