import { now } from '#backend/procedures/material/operations/artifact';
import { reviewCard } from '#backend/procedures/practice/operations/review';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const rating = {
      1: 'again',
      2: 'hard',
      3: 'good',
      4: 'easy'
    } as const;

    return {
      value: reviewCard(ctx.store, input.card, rating[input.rating], now())?.memory ?? null
    };
  });
