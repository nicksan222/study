import { sql } from '@study/db';
import * as schema from '@study/db/schema';

import { now } from '#server/procedures/practice/finish-question';
import type { ServerContext } from '#server/runtime/context';
import type { ProjectId, PracticeId } from '#server/shared/ids';
import type { Practice } from '#server/shared/study/types';

import { topUpPractice } from './practice.ts';

export function createPractice(ctx: ServerContext, project: ProjectId): Practice {
  return ctx.transaction(() => {
    const existing = practice(ctx, project);

    if (existing) return existing;

    const t = now();
    const id = ctx.db.orm
      .insert(schema.practices)
      .values({ project_id: project, created_at: t, updated_at: t })
      .run().lastInsertRowid as PracticeId;

    topUpPractice(ctx, id);

    return { id, projectId: project, createdAt: t, updatedAt: t };
  });
}

export function practice(ctx: ServerContext, project: ProjectId) {
  const row = ctx.db.orm
    .select()
    .from(schema.practices)
    .where(sql`project_id=${project}`)
    .get();

  return row
    ? {
        id: row.id,
        projectId: row.project_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;
}
