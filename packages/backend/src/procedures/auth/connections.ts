import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { auth } = context;

  return {
    chatgpt: auth.publicAccount()
  };
});
