import * as s from '@study/db/schema';
import { and, eq } from 'drizzle-orm';

import { publicProcedure } from '#backend/runtime/trpc';

import { membershipSchema } from './attach.ts';
import { materialRow } from './reads.ts';
import { materialTransaction } from './transactions.ts';
import { assertSession } from './writes.ts';

export const run = publicProcedure.input(membershipSchema).mutation(({ ctx, input }) =>
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
