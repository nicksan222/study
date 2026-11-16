/** @file Owns reviews within this feature. */

import type {
  dueCardsInputSchema,
  reviewCardInputSchema,
  reviewHistoryInputSchema
} from '@study/contracts';
import { Effect } from 'effect';

import { CardStore, ReviewStore } from '#server/features/learning/store/index';
import { Settings } from '#server/features/settings/index';
import { transaction, useStore } from '#server/platform/definitions/define-store';

export function* learningReviewOperations() {
  const settings = yield* Settings;

  const cards = yield* useStore(CardStore),
    reviews = yield* useStore(ReviewStore);

  return {
    card: cards.card,
    findCard: cards.findCard,
    reviewCard: (input: typeof reviewCardInputSchema.Type) =>
      transaction((tx) => tx.store(CardStore).reviewCard(input)),
    dueCards: Effect.fnUntraced(function* (input: typeof dueCardsInputSchema.Type) {
      const policy = yield* settings.reviewSettings();

      const items = yield* cards.cards({ ...input, ...policy });

      const last = items.at(-1);

      const cursor = last ? { due: last.due, cardId: last.snapshot.card_id } : undefined;

      const more =
        cursor && items.length === input.limit
          ? yield* cards.cards({ ...input, ...policy, cursor, limit: 1 })
          : [];

      return { items, nextCursor: more.length && cursor ? cursor : null };
    }),
    reviewHistory: Effect.fnUntraced(function* (input: typeof reviewHistoryInputSchema.Type) {
      const items = yield* reviews.reviews(input);

      const last = items.at(-1);

      const more =
        last && items.length === input.limit
          ? yield* reviews.reviews({ ...input, cursor: last.review.id, limit: 1 })
          : [];

      return { items, nextCursor: more.length && last ? last.review.id : null };
    })
  };
}
