import assert from 'node:assert/strict';
import { test } from 'node:test';

import { savePreferences as dbSavePreferences } from '#backend/procedures/settings/preferences';
import { createBackendTest } from '#testing/backend-test';

test('getReviewSettings reads default and persisted daily allowance', async (t) => {
  const f = await createBackendTest(t);

  assert.equal((await f.caller.settings.getReviewSettings()).newCardsPerDay, 20);
  dbSavePreferences(f.store, 'review', {
    newCardsPerDay: 0
  });
  assert.equal((await f.caller.settings.getReviewSettings()).newCardsPerDay, 0);
});
