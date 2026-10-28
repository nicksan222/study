import { deletePractice } from '#backend/procedures/practice/operations/delete-practice';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({ value: deletePractice(ctx.store, input.id) }));
