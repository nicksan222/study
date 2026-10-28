import * as s from '@study/db/schema';
import { and, eq } from 'drizzle-orm';

import { materialRow } from '#backend/procedures/materials/reads';
import { materialTransaction } from '#backend/procedures/materials/transactions';
import { assertSession } from '#backend/procedures/materials/writes';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) =>
    materialTransaction(ctx.store, () => {
      const material = materialRow(ctx.store, input.materialId);

      assertSession(ctx.store, input.sessionId, material.project_id);
      ctx.store.db.orm
        .delete(s.session_materials)
        .where(
          and(
            eq(s.session_materials.session_id, input.sessionId),
            eq(s.session_materials.material_id, input.materialId)
          )
        )
        .run();

      return input;
    })
  );
