/** @file Builds learning cards queries and mutations with bound store resources. */

import {
  cardInputSchema,
  cardSchema,
  dueCardSchema,
  dueCardsInputSchema,
  reviewCardInputSchema,
  reviewSettingsSchema,
  reviewedCardSchema
} from '@study/contracts';
import * as s from '@study/db';
import { eq } from '@study/db';
import { Schema } from 'effect';

import { makeCards } from '#server/features/learning/store/card-operations';
import { makeDueCards } from '#server/features/learning/store/due-cards';
import { makeReviewMaterialCard } from '#server/features/learning/store/review-material-card';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { optional } from './attempts.ts';

export function makeCardStore(resources: StoreResources) {
  const { db, clock } = resources;
  const { cardSnapshot } = makeCards(resources);
  const { dueCards } = makeDueCards(resources);
  const { reviewMaterialCard } = makeReviewMaterialCard(resources);
  const card = (input: typeof cardInputSchema.Type) => ({
    snapshot: cardSnapshot(input.versionId, input.cardId),
    schedule:
      db.orm
        .select()
        .from(s.material_card_schedules)
        .where(eq(s.material_card_schedules.card_id, input.cardId))
        .get() ?? null
  });

  return {
    queries: {
      card: storeQuery({
        role: 'required',
        input: cardInputSchema,
        output: cardSchema,
        run: card
      }),
      findCard: storeQuery({
        role: 'optional',
        input: cardInputSchema,
        output: Schema.Option(cardSchema),
        run: (input) => optional(() => card(input))
      }),
      cards: storeQuery({
        role: 'collection',
        input: Schema.Struct({
          ...dueCardsInputSchema.fields,
          ...reviewSettingsSchema.fields
        }),
        output: Schema.Array(dueCardSchema),
        run: (input) => dueCards(input).items
      })
    },
    mutations: {
      reviewCard: storeMutation({
        changes: ['learning'],
        input: reviewCardInputSchema,
        output: reviewedCardSchema,
        run: (input) =>
          reviewMaterialCard(input.versionId, input.cardId, input.rating, unixSeconds(clock))
      })
    }
  };
}
