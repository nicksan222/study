import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import {
  setPreference as dbSetPreference,
  savePreferences as dbSavePreferences
} from './preferences.ts';
test('getLlmSettings reads saved tier models and excludes credentials', async (t) => {
  const f = await fixture(t);
  const defaults = await f.caller.settings.getLlmSettings({});

  assert.equal(defaults.tiny?.provider, 1);
  assert.equal(defaults.tiny?.model, undefined);
  dbSavePreferences(f.store, 'llm', {
    tiny: 1,
    medium: 2,
    smart: 3
  });
  dbSetPreference(f.store, 'private.chatgpt', 'account', {
    refreshToken: 'private'
  });
  const result = await f.caller.settings.getLlmSettings({});

  assert.equal(result.tiny?.model, 1);
  assert.equal(result.medium?.model, 2);
  assert.equal(result.smart?.model, 3);
  assert.equal(JSON.stringify(result).includes('private'), false);
});
