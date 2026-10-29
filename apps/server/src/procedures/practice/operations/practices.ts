import { desc } from '@study/db';
import * as schema from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';

import { practiceScore } from './practice.ts';

export function listPractices(ctx: ServerContext) {
  return ctx.db.orm
    .select()
    .from(schema.practices)
    .orderBy(desc(schema.practices.updated_at), desc(schema.practices.id))
    .all()
    .map((row) => ({
      id: row.id,
      projectId: row.project_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      score: practiceScore(ctx, row.id)
    }));
}
