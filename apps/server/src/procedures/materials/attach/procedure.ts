import { attachMaterialTransaction } from '#server/procedures/materials/operations/session-membership';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    attachMaterialTransaction(ctx.store, input.sessionId, input.materialId);

    return input;
  });
