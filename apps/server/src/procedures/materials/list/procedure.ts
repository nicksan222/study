import { and, asc, desc, eq, gt, isNotNull, isNull, lt } from '@study/db';
import * as s from '@study/db/schema';

import { materialRow, readMaterialSummaries, required } from '#server/procedures/materials/reads';
import { assertProject, assertSession } from '#server/procedures/materials/writes';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    assertProject(ctx.store, input.projectId);
    const filters = [
      eq(s.materials.project_id, input.projectId),
      input.archived ? isNotNull(s.materials.archived_at) : isNull(s.materials.archived_at)
    ];

    if (input.cursor !== undefined) {
      const cursor = materialRow(ctx.store, input.cursor);

      if (cursor.project_id !== input.projectId)
        throw new StudyError('invalid_input', 'Invalid material cursor');
    }

    let ids: bigint[];

    if (input.sessionId !== undefined) {
      assertSession(ctx.store, input.sessionId, input.projectId);
      const cursor =
        input.cursor === undefined
          ? undefined
          : required(
              ctx.store.db.orm
                .select()
                .from(s.session_materials)
                .where(
                  and(
                    eq(s.session_materials.session_id, input.sessionId),
                    eq(s.session_materials.material_id, input.cursor)
                  )
                )
                .get()
            );

      ids = ctx.store.db.orm
        .select({ id: s.materials.id })
        .from(s.materials)
        .innerJoin(s.session_materials, eq(s.materials.id, s.session_materials.material_id))
        .where(
          and(
            ...filters,
            eq(s.session_materials.session_id, input.sessionId),
            cursor ? gt(s.session_materials.position, cursor.position) : undefined
          )
        )
        .orderBy(asc(s.session_materials.position))
        .limit(input.take + 1)
        .all()
        .map((row) => row.id);
    } else
      ids = ctx.store.db.orm
        .select({ id: s.materials.id })
        .from(s.materials)
        .where(
          and(...filters, input.cursor === undefined ? undefined : lt(s.materials.id, input.cursor))
        )
        .orderBy(desc(s.materials.id))
        .limit(input.take + 1)
        .all()
        .map((row) => row.id);

    const page = ids.slice(0, input.take);

    return {
      items: readMaterialSummaries(ctx.store, page),
      nextCursor: ids.length > input.take ? page.at(-1)! : null
    };
  });
