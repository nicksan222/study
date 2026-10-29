import { and, desc, eq, lt } from '@study/db';
import * as s from '@study/db/schema';

import { materialRow, versionRow } from '#server/procedures/materials/reads';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    materialRow(ctx.store, input.materialId);

    if (
      input.cursor !== undefined &&
      versionRow(ctx.store, input.cursor).material_id !== input.materialId
    )
      throw new StudyError('invalid_input', 'Invalid version cursor');

    const rows = ctx.store.db.orm
        .select()
        .from(s.material_versions)
        .where(
          and(
            eq(s.material_versions.material_id, input.materialId),
            input.cursor === undefined ? undefined : lt(s.material_versions.id, input.cursor)
          )
        )
        .orderBy(desc(s.material_versions.id))
        .limit(input.take + 1)
        .all(),
      page = rows.slice(0, input.take);

    return {
      items: page,
      nextCursor: rows.length > input.take ? page.at(-1)!.id : null
    };
  });
