import { z } from 'zod';

import { invalid } from '#backend/runtime/errors';
import { publicProcedure } from '#backend/runtime/trpc';

export const run = publicProcedure
  .input(
    z.object({
      attemptId: z.string()
    })
  )
  .mutation(async ({ ctx: context, input: r, signal }) => {
    const { auth } = context;

    if (!r.attemptId) invalid('Sign-in attempt required');

    await auth.finishSignIn(
      signal ? AbortSignal.any([signal, context.shutdown]) : context.shutdown,
      r.attemptId
    );

    return auth.publicAccount()!;
  });
