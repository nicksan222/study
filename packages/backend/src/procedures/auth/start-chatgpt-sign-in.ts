import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

export const run = publicProcedure
  .input(
    z.object({
      reconsent: z.boolean().default(false)
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { auth } = context;

    return auth.startSignIn(r.reconsent);
  });
