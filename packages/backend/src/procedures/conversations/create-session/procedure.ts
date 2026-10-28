import { createSession } from '#backend/procedures/conversations/operations/create-session';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => createSession(ctx.store, input.project, input.title));
