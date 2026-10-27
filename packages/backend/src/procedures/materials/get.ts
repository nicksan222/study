import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

import { readMaterial } from './reads.ts';
import { materialId } from './schemas.ts';

export const run = publicProcedure
  .input(z.object({ id: materialId }))
  .query(({ ctx, input }) => readMaterial(ctx.store, input.id));

export { readMaterial as getMaterial } from './reads.ts';
