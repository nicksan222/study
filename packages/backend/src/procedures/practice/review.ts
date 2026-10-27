import * as schema from '@study/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { reviewMaterialCard } from '#backend/procedures/learning/review-card';
import { cardRow, now } from '#backend/procedures/material/artifact';
import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { CardId } from '#backend/shared/ids';
import * as P from '#backend/shared/settings/types';
import { reviewMemory } from '#backend/shared/study/srs';
import type { Rating } from '#backend/shared/study/srs';
import type { Card } from '#backend/shared/study/types';

export const run = publicProcedure
  .input(
    z.object({
      card: idInput,
      rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;
    const rating: {
      [key: number]: 'again' | 'hard' | 'good' | 'easy';
    } = {
      [P.Rating.AGAIN]: 'again',
      [P.Rating.HARD]: 'hard',
      [P.Rating.GOOD]: 'good',
      [P.Rating.EASY]: 'easy'
    };
    const value = rating[r.rating];

    if (!value) invalid('Review rating required');

    const card = reviewCard(store, r.card, value, now());

    return {
      value: card ? card.memory : null
    };
  });

export function cardReviews(ctx: BackendContext, id: CardId) {
  return ctx.db.orm
    .select({
      card_id: schema.reviews.card_id,
      rating: schema.reviews.rating,
      reviewed_at: schema.reviews.reviewed_at,
      stability: schema.reviews.stability,
      difficulty: schema.reviews.difficulty,
      elapsed_days: schema.reviews.elapsed_days
    })
    .from(schema.reviews)
    .where(sql`card_id=${id}`)
    .orderBy(schema.reviews.id)
    .all()
    .map((row) => ({
      cardId: row.card_id,
      rating: row.rating as Rating,
      reviewedAt: row.reviewed_at,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsedDays: row.elapsed_days
    }));
}

export function reviewCard(
  ctx: BackendContext,
  id: CardId,
  rating: Rating,
  at: bigint
): Card | null {
  return ctx.transaction(() => {
    const row = ctx.db.orm
      .select()
      .from(schema.cards)
      .where(sql`id=${id}`)
      .get();

    if (!row) return null;

    if (row.material_card_id !== null) {
      const version = ctx.db.orm
        .select({ id: schema.material_versions.id })
        .from(schema.material_versions)
        .innerJoin(
          schema.material_flashcard_entries,
          eq(schema.material_flashcard_entries.version_id, schema.material_versions.id)
        )
        .where(
          and(
            eq(schema.material_flashcard_entries.card_id, row.material_card_id),
            eq(schema.material_versions.status, 'published')
          )
        )
        .orderBy(desc(schema.material_versions.number))
        .limit(1)
        .get();

      if (!version) throw new StudyError('not_found', 'published card version missing');

      reviewMaterialCard(ctx, version.id, row.material_card_id, rating, at);

      return cardRow(ctx.db.orm.select().from(schema.cards).where(eq(schema.cards.id, id)).get()!);
    }

    const before = cardRow(row);
    const next = reviewMemory(before.memory, rating, at);

    ctx.db.orm
      .insert(schema.reviews)
      .values({
        card_id: id,
        rating: rating,
        reviewed_at: at,
        stability: before.memory.stability,
        difficulty: before.memory.difficulty,
        elapsed_days:
          before.memory.lastReview === null
            ? 0
            : Number(at > before.memory.lastReview ? at - before.memory.lastReview : 0n) / 86400
      })
      .run();
    ctx.db.orm
      .update(schema.cards)
      .set({
        stability: next.stability,
        difficulty: next.difficulty,
        reps: BigInt(next.reps),
        lapses: BigInt(next.lapses),
        last_review: next.lastReview,
        due: next.due,
        state: BigInt(next.state),
        elapsed_days: BigInt(next.elapsedDays),
        scheduled_days: BigInt(next.scheduledDays),
        learning_steps: BigInt(next.learningSteps)
      })
      .where(sql`id=${id}`)
      .run();

    return cardRow(
      ctx.db.orm
        .select()
        .from(schema.cards)
        .where(sql`id=${id}`)
        .get()!
    );
  });
}
