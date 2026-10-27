import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';

import { required } from './reads.ts';
import { materialId } from './schemas.ts';
import { materialTransaction } from './transactions.ts';

export const run = publicProcedure
  .input(z.object({ sessionId: materialId, materialIds: z.array(materialId).max(10000) }))
  .mutation(({ ctx, input }) =>
    materialTransaction(ctx.store, () => {
      const db = ctx.store.db.orm;

      required(db.select().from(s.sessions).where(eq(s.sessions.id, input.sessionId)).get());
      const rows = db
        .select()
        .from(s.session_materials)
        .where(eq(s.session_materials.session_id, input.sessionId))
        .all();

      if (
        new Set(input.materialIds).size !== input.materialIds.length ||
        rows.length !== input.materialIds.length ||
        rows.some((r) => !input.materialIds.includes(r.material_id))
      )
        throw new StudyError(
          'invalid_input',
          'Reorder must include each session material exactly once'
        );

      db.delete(s.session_materials)
        .where(eq(s.session_materials.session_id, input.sessionId))
        .run();
      input.materialIds.forEach((id, i) => {
        const row = required(rows.find((r) => r.material_id === id));

        db.insert(s.session_materials)
          .values({ ...row, position: BigInt(i) })
          .run();
      });

      return { materialIds: input.materialIds };
    })
  );
