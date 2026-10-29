import { newCardAllowance, countDueCards } from '#server/procedures/practice/operations/due-count';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => ({
    value: countDueCards(ctx.store, input.project ?? null, input.until, newCardAllowance(ctx.store))
  }));
