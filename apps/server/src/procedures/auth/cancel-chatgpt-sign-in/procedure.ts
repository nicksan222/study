import { invalid } from '#server/runtime/errors';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    if (!input.attemptId) invalid('Sign-in attempt required');

    return { value: ctx.auth.cancelSignIn(input.attemptId) };
  });
