import * as s from '@study/db/schema';
import { and, desc, eq, lt } from 'drizzle-orm';

import { cardSnapshot } from '#server/procedures/learning/cards';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    cardSnapshot(ctx.store, input.versionId, input.cardId);
    const rows = ctx.store.db.orm
      .select({ review: s.material_card_reviews, snapshot: s.material_flashcard_entries })
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
      .limit(input.take + 1)
      .all();

    return {
      items: rows.slice(0, input.take),
      nextCursor: rows.length > input.take ? rows[input.take - 1]!.review.id : null
    };
  });
