import * as schema from '@study/db/schema';
import { sql, desc } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { ProjectId } from '#backend/shared/ids';
import type { Project } from '#backend/shared/projects/types';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store } = context;

  return {
    items: listProjects(store)
  };
});

export function nameOf(value: string): string {
  const name = value.trim();

  if (!name || [...name].length > 100)
    throw new StudyError('invalid_input', 'invalid project name');

  return name;
}

export function now(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function projectRow(row: typeof schema.projects.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    examOn: row.exam_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function sessionRow(row: typeof schema.sessions.$inferSelect) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    titleSource: row.title_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function titleOf(value: string): string {
  const title = value.trim();

  if (!title || [...title].length > 200)
    throw new StudyError('invalid_input', 'invalid session title');

  return title;
}

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
