import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { removeContent } from '#server/procedures/materials/content';
import { versionRow } from '#server/procedures/materials/reads';
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
      const version = versionRow(ctx.store, input.id, true),
        db = ctx.store.db.orm;

      if (
        db
          .select()
          .from(s.material_versions)
          .where(eq(s.material_versions.material_id, version.material_id))
          .all().length === 1
      )
        throw new StudyError('invalid_input', 'Cannot delete the only material version');

      db.delete(s.material_version_citations)
        .where(eq(s.material_version_citations.version_id, input.id))
        .run();
      db.delete(s.material_version_inputs)
        .where(eq(s.material_version_inputs.version_id, input.id))
        .run();
      db.delete(s.material_version_parents)
        .where(eq(s.material_version_parents.version_id, input.id))
        .run();
      removeContent(ctx.store, input.id);
      db.delete(s.material_versions).where(eq(s.material_versions.id, input.id)).run();

      return { id: input.id };
    })
  );
