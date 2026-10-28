import * as s from '@study/db/schema';
import { and, desc, eq, lt } from 'drizzle-orm';

import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const rows = ctx.store.db.orm
      .select({
        attempt: s.material_quiz_attempts,
        materialId: s.material_versions.material_id,
        projectId: s.material_versions.project_id
      })
      .from(s.material_quiz_attempts)
      .innerJoin(
        s.material_versions,
        eq(s.material_versions.id, s.material_quiz_attempts.version_id)
      )
      .where(
        and(
          input.projectId ? eq(s.material_versions.project_id, input.projectId) : undefined,
          input.materialId ? eq(s.material_versions.material_id, input.materialId) : undefined,
          input.cursor ? lt(s.material_quiz_attempts.id, input.cursor) : undefined
        )
      )
      .orderBy(desc(s.material_quiz_attempts.id))
      .limit(input.take + 1)
      .all();

    return {
      items: rows.slice(0, input.take),
      nextCursor: rows.length > input.take ? rows[input.take - 1]!.attempt.id : null
    };
  });
