import { deleteSource } from '#server/procedures/sources/operations/delete-source';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({
    value: deleteSource(ctx.store, input.id)
  }));
