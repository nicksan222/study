import { z } from 'zod';

import { invalid } from '#backend/runtime/errors';
import { publicProcedure } from '#backend/runtime/trpc';

export const run = publicProcedure
  .input(
    z.object({
      attemptId: z.string()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { auth } = context;

    if (!r.attemptId) invalid('Sign-in attempt required');

    return {
      value: auth.cancelSignIn(r.attemptId)
    };
  });
