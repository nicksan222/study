import { publicProcedure } from '#backend/runtime/trpc';

import { attemptInput } from './inputs.ts';
import { attemptView } from './quiz.ts';

export const run = publicProcedure
  .input(attemptInput)
  .query(({ ctx, input }) => attemptView(ctx.store, input.attemptId));
