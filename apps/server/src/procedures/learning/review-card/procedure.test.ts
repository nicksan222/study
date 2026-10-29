import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { setup, seedDeck } from '#server/procedures/learning/test-support';
import { newMemory, reviewMemory } from '#server/shared/study/srs';

test('reviewCard atomically appends immutable reviews and follows stable identity across revisions', async (t) => {
  const f = await setup(t),
    first = seedDeck(f);

  const one = await f.learning.reviewCard({ ...first, rating: 'good' });

  const latest = seedDeck(f, first);
  const two = await f.learning.reviewCard({ ...latest, rating: 'easy' });

  assert.equal(two.schedule.reps, 2n);
  const before = reviewMemory(newMemory(one.review.reviewed_at), 'good', one.review.reviewed_at);
  const expected = reviewMemory(before, 'easy', two.review.reviewed_at);

  assert.equal(two.schedule.due, expected.due);
  assert.equal(two.schedule.stability, expected.stability);
  assert.equal(two.schedule.difficulty, expected.difficulty);
  assert.equal(two.schedule.last_review, expected.lastReview);
  assert.equal(two.schedule.elapsed_days, BigInt(expected.elapsedDays));
  assert.equal(two.schedule.scheduled_days, BigInt(expected.scheduledDays));
  assert.equal(two.schedule.learning_steps, BigInt(expected.learningSteps));
  assert.equal(
    two.review.elapsed_days,
    Number(two.review.reviewed_at - one.review.reviewed_at) / 86400
  );
  const reviews = f.store.db.orm
    .select()
    .from(s.material_card_reviews)
    .where(eq(s.material_card_reviews.card_id, first.cardId))
    .all();

  assert.equal(reviews.length, 2);
  assert.equal(reviews[0]!.version_id, first.versionId);
  assert.equal(reviews[1]!.version_id, latest.versionId);
  await assert.rejects(f.learning.reviewCard({ ...first, rating: 'invalid' as 'good' }), {
    kind: 'invalid_input'
  });
  await assert.rejects(
    f.learning.reviewCard({ versionId: first.versionId, cardId: 999999n, rating: 'again' }),
    { kind: 'not_found' }
  );
  assert.equal(f.store.db.orm.select().from(s.material_card_reviews).all().length, 2);
});

test('reviewCard rejects drafts and rolls scheduling back if review insertion fails', async (t) => {
  const f = await setup(t),
    first = seedDeck(f),
    draft = seedDeck(f, first, 1, false);

  await assert.rejects(f.learning.reviewCard({ ...draft, rating: 'good' }), { kind: 'not_found' });
  const one = await f.learning.reviewCard({ ...first, rating: 'hard' });

  f.store.db.exec(
    "CREATE TEMP TRIGGER reject_learning_review BEFORE INSERT ON material_card_reviews BEGIN SELECT RAISE(ABORT, 'injected review failure'); END;"
  );
  await assert.rejects(f.learning.reviewCard({ ...first, rating: 'easy' }));
  const card = await f.learning.getCard(first);

  assert.deepEqual(card.schedule, one.schedule);
  assert.equal((await f.learning.reviewHistory(first)).items.length, 1);
});
