import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { materialRow, readMaterial, required } from '#server/procedures/materials/reads';
import { materialTransaction } from '#server/procedures/materials/transactions';
import { now } from '#server/procedures/materials/writes';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
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
