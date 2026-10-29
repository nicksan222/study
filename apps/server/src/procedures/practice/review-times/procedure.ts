import { reviewTimes } from '#server/procedures/practice/operations/review-times';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => ({
    items: reviewTimes(ctx.store, input.project ?? null, input.since)
  }));
