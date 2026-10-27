import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { savePreferences as dbSavePreferences } from './preferences.ts';
test('getReviewSettings reads default and persisted daily allowance', async (t) => {
  const f = await fixture(t);

  assert.equal((await f.caller.settings.getReviewSettings({})).newCardsPerDay, 20);
  dbSavePreferences(f.store, 'review', {
    newCardsPerDay: 0
  });
  assert.equal((await f.caller.settings.getReviewSettings({})).newCardsPerDay, 0);
});
