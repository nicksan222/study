import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { setup, seedDeck } from '#backend/procedures/learning/test-support';

test('dueCards includes unscheduled cards, paginates ties and uses latest published entries', async (t) => {
  const f = await setup(t),
    first = seedDeck(f, undefined, 3);
  const page = await f.learning.dueCards({ projectId: f.project.id, before: 0n, take: 2 });

  assert.equal(page.items.length, 2);
  const next = await f.learning.dueCards({
    projectId: f.project.id,
    before: 0n,
    take: 2,
    cursor: page.nextCursor!
  });

  assert.equal(next.items.length, 1);
  assert.equal(next.nextCursor, null);
  assert.equal(new Set([...page.items, ...next.items].map((c) => c.snapshot.card_id)).size, 3);
  const latest = seedDeck(f, first);
  const due = await f.learning.dueCards({ projectId: f.project.id });

  assert.deepEqual(
    due.items.map((c) => c.snapshot.version_id),
    [latest.versionId]
  );
  await f.learning.reviewCard({ ...latest, rating: 'easy' });
  assert.equal((await f.learning.dueCards({ projectId: f.project.id })).items.length, 0);
  assert.equal((await f.learning.dueCards({ projectId: 99999n })).items.length, 0);
});

test('dueCards ignores a newer draft and excludes archived decks', async (t) => {
  const f = await setup(t),
    first = seedDeck(f);

  seedDeck(f, first, 1, false);
  const due = await f.learning.dueCards({ projectId: f.project.id });

  assert.equal(due.items.length, 1);
  assert.equal(due.items[0]!.snapshot.version_id, first.versionId);
  f.store.db.orm
    .update(s.materials)
    .set({ archived_at: 2n })
    .where(eq(s.materials.id, first.materialId))
    .run();
  assert.equal((await f.learning.dueCards({ projectId: f.project.id })).items.length, 0);
});
