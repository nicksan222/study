import { desc, sql } from '@study/db';
import * as schema from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';
import type { ProjectId } from '#server/shared/ids';
import type { Project } from '#server/shared/projects/schemas';

import { projectRow } from './project-rows.ts';

export function listProjects(ctx: ServerContext): Project[] {
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

export function project(ctx: ServerContext, id: ProjectId): Project | null {
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
