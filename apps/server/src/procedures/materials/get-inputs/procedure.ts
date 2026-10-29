import * as s from '@study/db/schema';
import { and, asc, eq, gt } from 'drizzle-orm';

import { versionRow } from '#server/procedures/materials/reads';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    versionRow(ctx.store, input.id);
    const rows = ctx.store.db.orm
        .select({ version: s.material_versions })
        .from(s.material_version_inputs)
        .innerJoin(
          s.material_versions,
          eq(s.material_versions.id, s.material_version_inputs.input_version_id)
        )
        .where(
          and(
            eq(s.material_version_inputs.version_id, input.id),
            input.cursor === undefined
              ? undefined
              : gt(s.material_version_inputs.input_version_id, input.cursor)
          )
        )
        .orderBy(asc(s.material_version_inputs.input_version_id))
        .limit(input.take + 1)
        .all(),
      page = rows.slice(0, input.take);

    return {
      items: page.map((row) => row.version),
      nextCursor: rows.length > input.take ? page.at(-1)!.version.id : null
    };
  });
