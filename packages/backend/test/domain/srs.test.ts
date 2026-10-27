import assert from 'node:assert/strict';
import { test } from 'node:test';

import { newMemory, reviewMemory } from '#backend/shared/study/srs';

test('FSRS schedules grades and carries full memory through reviews', () => {
  const now = 1800000000n;
  const first = newMemory(now);
  const again = reviewMemory(first, 'again', now);
  const good = reviewMemory(first, 'good', now);
  const easy = reviewMemory(first, 'easy', now);

  assert.equal(again.due, now + 600n);
  assert.ok(good.due > now);
  assert.ok(easy.due >= good.due);
  assert.equal(good.reps, 1);
  assert.equal(good.lastReview, now);
  const later = reviewMemory(good, 'good', good.due);

  assert.equal(later.reps, 2);
  assert.ok(later.due > good.due);
  assert.equal(later.lastReview, good.due);
});
test('invalid grades are rejected and elapsed review timestamps round trip', () => {
  const start = 1800000000n;
  const first = reviewMemory(newMemory(start), 'easy', start);
  const later = reviewMemory(first, 'again', first.due);

  assert.equal(later.lastReview, first.due);
  assert.equal(later.due, first.due + 600n);
  assert.ok(later.lapses >= 1);
  assert.throws(() => reviewMemory(first, 'toString' as never, first.due));
});
