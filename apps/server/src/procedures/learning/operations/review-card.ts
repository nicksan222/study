import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { cardSnapshot, cardMemory } from '#server/procedures/learning/cards';
import { now } from '#server/procedures/learning/quiz';
import type { ServerContext } from '#server/runtime/context';
import { invalid } from '#server/runtime/errors';
import { requireRow } from '#server/shared/errors/index';
import { reviewMemory } from '#server/shared/study/srs';
import type { Rating } from '#server/shared/study/srs';

const states = ['new', 'learning', 'review', 'relearning'] as const;

/** Canonical memory and history own reviews; legacy rows are transactional projections. */
export function reviewMaterialCard(
  store: ServerContext,
  versionId: bigint,
  cardId: bigint,
  rating: Rating,
  at = now()
) {
  return store.transaction(() => {
    const snapshot = cardSnapshot(store, versionId, cardId);
    const before = cardMemory(store, cardId, at);

    if (before.lastReview !== null && at < before.lastReview)
      invalid('review precedes previous review');

    const next = reviewMemory(before, rating, at);
    const memory = {
      due: next.due,
      last_review: next.lastReview,
      elapsed_days: BigInt(next.elapsedDays),
      scheduled_days: BigInt(next.scheduledDays),
      learning_steps: BigInt(next.learningSteps),
      stability: next.stability,
      difficulty: next.difficulty,
      reps: BigInt(next.reps),
      lapses: BigInt(next.lapses)
    };
    const values = { card_id: cardId, ...memory, state: states[next.state] };

    store.db.orm
      .insert(s.material_card_schedules)
      .values(values)
      .onConflictDoUpdate({ target: s.material_card_schedules.card_id, set: values })
      .run();
    const elapsedDays = before.lastReview === null ? 0 : Number(at - before.lastReview) / 86400;
    const review = requireRow(
      store.db.orm
        .insert(s.material_card_reviews)
        .values({
          card_id: cardId,
          version_id: versionId,
          reviewed_at: at,
          rating,
          elapsed_days: elapsedDays
        })
        .returning()
        .get()
    );

    const mapped = store.db.orm
      .select({ id: s.cards.id })
      .from(s.cards)
      .where(eq(s.cards.material_card_id, cardId))
      .all();

    if (mapped.length) {
      store.db.orm
        .update(s.cards)
        .set({ ...memory, state: BigInt(next.state) })
        .where(eq(s.cards.material_card_id, cardId))
        .run();
      store.db.orm
        .insert(s.reviews)
        .values(
          mapped.map((card) => ({
            card_id: card.id,
            rating,
            reviewed_at: at,
            stability: before.stability,
            difficulty: before.difficulty,
            elapsed_days: elapsedDays
          }))
        )
        .run();
    }

    return { snapshot, schedule: values, review };
  });
}
