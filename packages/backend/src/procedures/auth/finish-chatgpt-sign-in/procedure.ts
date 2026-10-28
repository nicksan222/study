import { invalid } from '#backend/runtime/errors';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(async ({ ctx, input, signal }) => {
    if (!input.attemptId) invalid('Sign-in attempt required');

    await ctx.auth.finishSignIn(
      signal ? AbortSignal.any([signal, ctx.shutdown]) : ctx.shutdown,
      input.attemptId
    );

    const account = ctx.auth.publicAccount()!;

    return {
      subject: account.subject,
      email: account.email,
      sharing: account.sharing
    };
  });
