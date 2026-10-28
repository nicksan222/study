import { readVersion, required } from '#backend/procedures/materials/reads';
import { materialTransaction } from '#backend/procedures/materials/transactions';
import { publish } from '#backend/procedures/materials/writes';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) =>
    materialTransaction(ctx.store, () => {
      publish(ctx.store, input.id);

      return required(readVersion(ctx.store, input.id));
    })
  );
