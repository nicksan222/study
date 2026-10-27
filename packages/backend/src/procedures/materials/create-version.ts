import { publicProcedure } from '#backend/runtime/trpc';

import { readVersion, required } from './reads.ts';
import { createVersionSchema, materialId } from './schemas.ts';
import { materialTransaction } from './transactions.ts';
import { insertVersion } from './writes.ts';

export const run = publicProcedure
  .input(createVersionSchema.safeExtend({ materialId }))
  .mutation(({ ctx, input }) =>
    materialTransaction(ctx.store, () =>
      required(readVersion(ctx.store, insertVersion(ctx.store, input.materialId, input)))
    )
  );
