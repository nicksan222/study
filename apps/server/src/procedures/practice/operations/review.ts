import * as schema from '@study/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';

import { reviewMaterialCard } from '#server/procedures/learning/operations/review-card';
import { cardRow } from '#server/procedures/material/operations/artifact';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { CardId } from '#server/shared/ids';
import { reviewMemory } from '#server/shared/study/srs';
import type { Rating } from '#server/shared/study/srs';
import type { Card } from '#server/shared/study/types';

export function cardReviews(ctx: ServerContext, id: CardId) {
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
  ctx: ServerContext,
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
