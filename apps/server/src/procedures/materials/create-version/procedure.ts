import { readVersion, required } from '#server/procedures/materials/reads';
import { materialTransaction } from '#server/procedures/materials/transactions';
import { insertVersion } from '#server/procedures/materials/writes';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) =>
    materialTransaction(ctx.store, () =>
      required(readVersion(ctx.store, insertVersion(ctx.store, input.materialId, input)))
    )
  );
