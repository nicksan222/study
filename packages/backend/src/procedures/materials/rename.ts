import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';

import { materialRow, readMaterial, required } from './reads.ts';
import { materialId } from './schemas.ts';
import { materialTransaction } from './transactions.ts';
import { now } from './writes.ts';

export const run = publicProcedure
  .input(z.object({ id: materialId, title: z.string().trim().min(1).max(200) }))
  .mutation(({ ctx, input }) =>
    materialTransaction(ctx.store, () => {
      materialRow(ctx.store, input.id, true);
      ctx.store.db.orm
        .update(s.materials)
        .set({ title: input.title, updated_at: now() })
        .where(eq(s.materials.id, input.id))
        .run();

      ctx.store.db.orm
        .update(s.artifacts)
        .set({ title: input.title, updated_at: now() })
        .where(eq(s.artifacts.material_id, input.id))
        .run();

      return required(readMaterial(ctx.store, input.id));
    })
  );
