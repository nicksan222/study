import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture } from '#testing/procedures';

import { loadPreferences as dbLoadPreferences } from './preferences.ts';
test('saveReviewSettings stores boundary allowances and preserves the previous value on rejection', async (t) => {
  const f = await fixture(t);

  await f.caller.settings.saveReviewSettings({
    newCardsPerDay: 0
  });
  assert.equal(dbLoadPreferences(f.store, 'review').newCardsPerDay, 0);
  await f.caller.settings.saveReviewSettings({
    newCardsPerDay: 10000
  });
  await assert.rejects(
    f.caller.settings.saveReviewSettings({
      newCardsPerDay: 10001
    }),
    {
      kind: 'invalid_input'
    }
  );
  assert.equal(dbLoadPreferences(f.store, 'review').newCardsPerDay, 10000);
});
