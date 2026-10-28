import { now } from '#backend/procedures/material/operations/artifact';
import { newCardAllowance, countDueCards } from '#backend/procedures/practice/operations/due-count';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => ({
    value: countDueCards(ctx.store, input.project ?? null, now(), newCardAllowance(ctx.store))
  }));
