import type { MaterialVersionId, MaterialCardId } from '@study/contracts/ids';
import type { reviewCardInputSchema } from '@study/contracts/learning/rpc';
import * as s from '@study/db/schema';

import { requireRow } from '#server/platform/database/rows';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';
import { reviewMemory } from '#server/platform/scheduling/fsrs';

import { makeCards } from './cards.ts';

const states = ['new', 'learning', 'review', 'relearning'] as const;

/** Schedule and record a review against its published snapshot. */
export function makeReviewMaterialCard(resources: StoreResources) {
  const { db } = resources;
  const { cardSnapshot, cardMemory } = makeCards(resources);

  function reviewMaterialCard(
    versionId: MaterialVersionId,
    cardId: MaterialCardId,
    rating: typeof reviewCardInputSchema.Type.rating,
    at: bigint
  ) {
    const snapshot = cardSnapshot(versionId, cardId);
    const before = cardMemory(cardId, at);

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
    const values = {
      card_id: cardId,
      ...memory,
      state: states[next.state]
    };

    db.orm
      .insert(s.material_card_schedules)
      .values(values)
      .onConflictDoUpdate({
        target: s.material_card_schedules.card_id,
        set: values
      })
      .run();
    const elapsedDays = before.lastReview === null ? 0 : Number(at - before.lastReview) / 86400;
    const review = requireRow(
      db.orm
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

    return {
      snapshot,
      schedule: values,
      review
    };
  }

  return {
    reviewMaterialCard
  };
}
