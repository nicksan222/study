import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { loadPreferences as dbLoadPreferences } from './preferences.ts';
test('saveAppSettings persists bilingual preferences and rejects invalid settings atomically', async (t) => {
  const f = await fixture(t);
  const valid = {
    language: 2,
    appearance: 1,
    zoomPercent: 125,
    onboarded: true
  } as const;

  await f.caller.settings.saveAppSettings(valid);
  assert.equal(dbLoadPreferences(f.store, 'app').zoomPercent, 125);

  for (const change of [
    {
      language: 0
    },
    {
      appearance: 0
    },
    {
      zoomPercent: 49
    },
    {
      zoomPercent: 201
    }
  ])
    await assert.rejects(
      f.caller.settings.saveAppSettings({
        ...valid,
        ...change
      } as never),
      {
        kind: 'invalid_input'
      }
    );

  assert.equal(dbLoadPreferences(f.store, 'app').zoomPercent, 125);
});
