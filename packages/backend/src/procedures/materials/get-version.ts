import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

import { readVersion } from './reads.ts';
import { materialId } from './schemas.ts';

export const run = publicProcedure
  .input(z.object({ id: materialId }))
  .query(({ ctx, input }) => readVersion(ctx.store, input.id));

export { readVersion as getVersion } from './reads.ts';
