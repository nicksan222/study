/** @file Builds learning reviews queries and mutations with bound store resources. */

import { reviewHistoryInputSchema, reviewHistoryItemSchema } from '@study/contracts';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makeReviewHistory } from '#server/features/learning/store/review-history';

export function makeReviewStore(resources: StoreResources) {
  const { reviewHistory } = makeReviewHistory(resources);

  return {
    queries: {
      reviews: storeQuery({
        role: 'collection',
        input: reviewHistoryInputSchema,
        output: Schema.Array(reviewHistoryItemSchema),
        run: (input) => reviewHistory(input).items
      })
    },
    mutations: {}
  };
}
