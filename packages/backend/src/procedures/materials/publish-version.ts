import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

import { readVersion, required } from './reads.ts';
import { materialId } from './schemas.ts';
import { materialTransaction } from './transactions.ts';
import { publish } from './writes.ts';

export const run = publicProcedure.input(z.object({ id: materialId })).mutation(({ ctx, input }) =>
  materialTransaction(ctx.store, () => {
    publish(ctx.store, input.id);

    return required(readVersion(ctx.store, input.id));
  })
);
