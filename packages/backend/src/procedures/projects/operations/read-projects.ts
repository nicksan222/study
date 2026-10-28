import * as schema from '@study/db/schema';
import { desc, sql } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { ProjectId } from '#backend/shared/ids';
import type { Project } from '#backend/shared/projects/schemas';

import { projectRow } from './project-rows.ts';

export function listProjects(ctx: BackendContext): Project[] {
  return ctx.db.orm
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      exam_on: schema.projects.exam_on,
      created_at: schema.projects.created_at,
      updated_at: schema.projects.updated_at
    })
    .from(schema.projects)
    .orderBy(desc(schema.projects.id))
    .all()
    .map(projectRow);
}

export function project(ctx: BackendContext, id: ProjectId): Project | null {
  const row = ctx.db.orm
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      exam_on: schema.projects.exam_on,
      created_at: schema.projects.created_at,
      updated_at: schema.projects.updated_at
    })
    .from(schema.projects)
    .where(sql`id = ${id}`)
    .get();

  return row ? projectRow(row) : null;
}
