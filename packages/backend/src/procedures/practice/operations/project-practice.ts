import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { now } from '#backend/procedures/practice/finish-question';
import type { BackendContext } from '#backend/runtime/context';
import type { ProjectId, PracticeId } from '#backend/shared/ids';
import type { Practice } from '#backend/shared/study/types';

import { topUpPractice } from './practice.ts';

export function createPractice(ctx: BackendContext, project: ProjectId): Practice {
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

export function practice(ctx: BackendContext, project: ProjectId) {
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
