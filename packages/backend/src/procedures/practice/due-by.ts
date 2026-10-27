import { z } from 'zod';

import { publicProcedure, idInput } from '#backend/runtime/trpc';

import { newCardAllowance, countDueCards as opCountDueCards } from './due-count.ts';

export const run = publicProcedure
  .input(
    z.object({
      project: idInput.nullish(),
      until: z.bigint().default(0n)
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: opCountDueCards(store, r.project ?? null, r.until, newCardAllowance(store))
    };
  });
