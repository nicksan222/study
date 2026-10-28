import { readVersion, required } from '#backend/procedures/materials/reads';
import { materialTransaction } from '#backend/procedures/materials/transactions';
import { insertVersion } from '#backend/procedures/materials/writes';
import { publicProcedure } from '#backend/runtime/trpc';

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
