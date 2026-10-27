import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

import { setArchived } from './archive.ts';
import { materialId } from './schemas.ts';

export const run = publicProcedure
  .input(z.object({ id: materialId }))
  .mutation(({ ctx, input }) => setArchived(ctx.store, input.id, false));
