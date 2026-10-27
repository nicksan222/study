import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

export const run = publicProcedure.input(z.object({}).default({})).mutation(({ ctx: context }) => {
  const { workers } = context;

  workers.start();

  return {};
});
