import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

export const run = publicProcedure
  .input(z.object({}).default({}))
  .mutation(async ({ ctx: context }) => {
    const { auth } = context;

    await auth.signOut();

    return {};
  });
