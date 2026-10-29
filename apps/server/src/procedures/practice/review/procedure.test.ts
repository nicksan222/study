import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { setup, seedDeck } from '#server/procedures/learning/test-support';
import {
  reviewCard,
  cardReviews as opCardReviews
} from '#server/procedures/practice/operations/review';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { reviewMemory } from '#server/shared/study/srs';
import { completeMaterial } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

import { inputValidator } from './input.ts';

test('review persists the selected rating and rejects missing cards and unspecified ratings', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const made = completeMaterial(f.store, project.id);
  const result = await f.caller.practice.review({
    card: BigInt(made.card.id),
    rating: 3
  });

  assert.ok(result.value);
  assert.equal(opCardReviews(f.store, made.card.id).length, 1);
  assert.equal(
    (
      await f.caller.practice.review({
        card: 999999n,
        rating: 3
      })
    ).value,
    null
  );
  await assert.rejects(f.caller.practice.review({ card: 0n, rating: 3 }), {
    kind: 'invalid_input'
  });
});

test('review input validator rejects an unspecified rating', async () => {
  const result = await inputValidator['~standard'].validate({ card: 1n, rating: 0 });

  assert.ok(result.issues && result.issues.length > 0);
});

test('legacy and canonical reviews share schedules and both histories across revisions', async (t) => {
  const f = await setup(t),
    made = completeMaterial(f.store, f.project.id);
  const cardId = made.card.materialCardId;

  assert.ok(cardId);
  const firstEntry = f.store.db.orm
    .select()
    .from(s.material_flashcard_entries)
    .where(eq(s.material_flashcard_entries.card_id, cardId))
    .get()!;
  const first = await f.caller.practice.review({ card: made.card.id, rating: 3 });

  assert.equal(first.value?.reps, 1);
  assert.equal((await f.caller.practice.dueCards({ project: f.project.id })).items.length, 0);
  const latest = seedDeck(f, { materialId: firstEntry.material_id, cardId });

  // Deliberately stale projection memory must never drive canonical scheduling.
  f.store.db.orm
    .update(s.cards)
    .set({ reps: 99n, stability: 99, difficulty: 9 })
    .where(eq(s.cards.id, made.card.id))
    .run();
  const second = await f.learning.reviewCard({ ...latest, rating: 'easy' });
  const projection = f.store.db.orm
    .select()
    .from(s.cards)
    .where(eq(s.cards.id, made.card.id))
    .get()!;
  const expected = reviewMemory(first.value!, 'easy', second.review.reviewed_at);

  assert.equal(second.schedule.reps, 2n);
  assert.equal(projection.reps, 2n);
  assert.equal(projection.stability, expected.stability);
  assert.equal(projection.due, second.schedule.due);
  assert.equal(projection.last_review, second.schedule.last_review);
  assert.equal(projection.state, BigInt(expected.state));
  assert.equal(projection.elapsed_days, second.schedule.elapsed_days);
  assert.equal(projection.scheduled_days, second.schedule.scheduled_days);
  assert.equal(projection.learning_steps, second.schedule.learning_steps);
  const canonical = await f.learning.reviewHistory(latest);

  assert.equal(canonical.items.length, 2);
  assert.equal(canonical.items[0]!.snapshot.version_id, latest.versionId);
  assert.equal(canonical.items[0]!.snapshot.front, 'Front 1');
  assert.equal(canonical.items[1]!.snapshot.version_id, firstEntry.version_id);
  assert.equal(canonical.items[1]!.snapshot.front, 'Gravity?');
  const legacy = opCardReviews(f.store, made.card.id);

  assert.equal(legacy.length, 2);
  assert.equal(legacy[1]!.stability, first.value!.stability);
  assert.deepEqual(
    (await f.caller.practice.reviewTimes({ project: f.project.id })).items,
    legacy.map((r) => r.reviewedAt)
  );
  assert.equal((await f.caller.practice.dueCards({ project: f.project.id })).items.length, 0);
});

test('legacy review resolves the latest published snapshot containing a mapped stable card', async (t) => {
  const f = await setup(t),
    made = completeMaterial(f.store, f.project.id),
    cardId = made.card.materialCardId;

  assert.ok(cardId);
  const identity = f.store.db.orm
    .select()
    .from(s.material_card_identities)
    .where(eq(s.material_card_identities.id, cardId))
    .get()!;
  const latest = seedDeck(f, { materialId: identity.material_id, cardId });

  seedDeck(f, latest, 1, false);
  const at = BigInt(Math.floor(Date.now() / 1000)) - 86400n;
  const result = reviewCard(f.store, made.card.id, 'good', at)!;

  assert.equal(result.memory.reps, 1);
  assert.equal(result.memory.lastReview, at);
  const history = await f.learning.reviewHistory(latest);

  assert.equal(history.items.length, 1);
  assert.equal(history.items[0]!.review.version_id, latest.versionId);
  assert.equal(history.items[0]!.review.reviewed_at, at);
  assert.equal(opCardReviews(f.store, made.card.id).length, 1);
});

test('both entrypoints roll all projections and histories back when canonical insertion fails', async (t) => {
  const f = await setup(t),
    made = completeMaterial(f.store, f.project.id),
    cardId = made.card.materialCardId;

  assert.ok(cardId);
  const entry = f.store.db.orm
    .select()
    .from(s.material_flashcard_entries)
    .where(eq(s.material_flashcard_entries.card_id, cardId))
    .get()!;

  await f.caller.practice.review({ card: made.card.id, rating: 3 });
  const snapshot = () => ({
    legacy: f.store.db.orm.select().from(s.cards).where(eq(s.cards.id, made.card.id)).get(),
    schedule: f.store.db.orm
      .select()
      .from(s.material_card_schedules)
      .where(eq(s.material_card_schedules.card_id, cardId))
      .get(),
    legacyReviews: opCardReviews(f.store, made.card.id),
    canonicalReviews: f.store.db.orm
      .select()
      .from(s.material_card_reviews)
      .where(eq(s.material_card_reviews.card_id, cardId))
      .all()
  });
  const before = snapshot();

  f.store.db.exec(
    "CREATE TEMP TRIGGER reject_integrated_review BEFORE INSERT ON material_card_reviews BEGIN SELECT RAISE(ABORT, 'injected canonical failure'); END;"
  );
  await assert.rejects(f.caller.practice.review({ card: made.card.id, rating: 4 }));
  assert.deepEqual(snapshot(), before);
  await assert.rejects(
    f.learning.reviewCard({ versionId: entry.version_id, cardId, rating: 'easy' })
  );
  assert.deepEqual(snapshot(), before);
});

test('unmapped cards retain the legacy review path without canonical writes', async (t) => {
  const f = await setup(t),
    made = completeMaterial(f.store, f.project.id);

  f.store.db.orm
    .update(s.cards)
    .set({ material_card_id: null })
    .where(eq(s.cards.id, made.card.id))
    .run();
  const result = await f.caller.practice.review({ card: made.card.id, rating: 3 });

  assert.equal(result.value?.reps, 1);
  assert.equal(opCardReviews(f.store, made.card.id).length, 1);
  assert.deepEqual(f.store.db.orm.select().from(s.material_card_schedules).all(), []);
  assert.deepEqual(f.store.db.orm.select().from(s.material_card_reviews).all(), []);
});
