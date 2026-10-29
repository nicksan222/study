import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { required } from '#server/procedures/materials/reads';
import { materialTransaction } from '#server/procedures/materials/transactions';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
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
        rows.some((row) => !input.materialIds.includes(row.material_id))
      )
        throw new StudyError(
          'invalid_input',
          'Reorder must include each session material exactly once'
        );

      db.delete(s.session_materials)
        .where(eq(s.session_materials.session_id, input.sessionId))
        .run();
      input.materialIds.forEach((id, index) => {
        const row = required(rows.find((item) => item.material_id === id));

        db.insert(s.session_materials)
          .values({ ...row, position: BigInt(index) })
          .run();
      });

      return { materialIds: input.materialIds };
    })
  );
