import { correctBlock } from '#server/procedures/sources/operations/correct-block';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({
    value:
      correctBlock(
        ctx.store,
        input.id,
        input.documentId,
        input.ordinal,
        input.before,
        input.after
      ) !== null
  }));
