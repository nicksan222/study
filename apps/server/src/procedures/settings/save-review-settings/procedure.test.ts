import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadPreferences as dbLoadPreferences } from '#server/procedures/settings/preferences';
import { createServerTest } from '#testing/server-test';

test('saveReviewSettings stores boundary allowances and preserves the previous value on rejection', async (t) => {
  const f = await createServerTest(t);

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
