import { createPractice } from '#backend/procedures/practice/operations/project-practice';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const value = createPractice(ctx.store, input.id);

    ctx.wake();

    return { id: value.id };
  });
