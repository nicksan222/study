import type { attemptsInputSchema } from '@study/contracts/learning/rpc';
import { and, desc, eq, lt } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof attemptsInputSchema.Type;

export function makeListAttempts(resources: StoreResources) {
  const { db } = resources;
  const listAttempts = (input: Input) => {
    const rows = db.orm
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
      .limit(input.limit + 1)
      .all();

    return {
      items: rows.slice(0, input.limit),
      nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.attempt.id : null
    };
  };

  return {
    listAttempts
  };
}
