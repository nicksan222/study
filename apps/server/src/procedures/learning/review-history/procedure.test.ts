import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setup, seedDeck } from '#server/procedures/learning/test-support';

test('reviewHistory pages across revisions with original front/back snapshots', async (t) => {
  const f = await setup(t),
    first = seedDeck(f);

  await f.learning.reviewCard({ ...first, rating: 'again' });
  const latest = seedDeck(f, first);

  await f.learning.reviewCard({ ...latest, rating: 'good' });
  const page = await f.learning.reviewHistory({ ...latest, take: 1 });

  assert.equal(page.items[0]!.snapshot.front, 'Front 1');
  const next = await f.learning.reviewHistory({ ...first, take: 1, cursor: page.nextCursor! });

  assert.equal(next.items[0]!.snapshot.front, 'Front 0');
  assert.equal(next.nextCursor, null);
});
