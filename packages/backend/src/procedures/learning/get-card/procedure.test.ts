import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setup, seedDeck } from '#backend/procedures/learning/test-support';

test('getCard reads retained version snapshots and validates card ownership', async (t) => {
  const f = await setup(t),
    first = seedDeck(f),
    second = seedDeck(f, first),
    other = seedDeck(f);

  assert.equal((await f.learning.getCard(first)).snapshot.front, 'Front 0');
  assert.equal((await f.learning.getCard(second)).snapshot.front, 'Front 1');
  await assert.rejects(f.learning.getCard({ versionId: first.versionId, cardId: other.cardId }), {
    kind: 'not_found'
  });
});
