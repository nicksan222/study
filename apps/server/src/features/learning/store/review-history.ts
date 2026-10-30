import type { reviewHistoryInputSchema } from '@study/contracts/learning/rpc';
import { and, desc, eq, lt } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeCards } from './cards.ts';

type Input = typeof reviewHistoryInputSchema.Type;

export function makeReviewHistory(resources: StoreResources) {
  const { db } = resources;
  const { cardSnapshot } = makeCards(resources);
  const reviewHistory = (input: Input) => {
    cardSnapshot(input.versionId, input.cardId);
    const rows = db.orm
      .select({
        review: s.material_card_reviews,
        snapshot: s.material_flashcard_entries
      })
      .from(s.material_card_reviews)
      .innerJoin(
        s.material_flashcard_entries,
        and(
          eq(s.material_flashcard_entries.version_id, s.material_card_reviews.version_id),
          eq(s.material_flashcard_entries.card_id, s.material_card_reviews.card_id)
        )
      )
      .where(
        and(
          eq(s.material_card_reviews.card_id, input.cardId),
          input.cursor ? lt(s.material_card_reviews.id, input.cursor) : undefined
        )
      )
      .orderBy(desc(s.material_card_reviews.id))
      .limit(input.limit + 1)
      .all();

    return {
      items: rows.slice(0, input.limit),
      nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.review.id : null
    };
  };

  return {
    reviewHistory
  };
}
