import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ProjectId } from '#backend/shared/ids';
import type { PracticeId } from '#backend/shared/ids';
import type { Practice } from '#backend/shared/study/types';

import { now } from './finish-question.ts';
import { topUpPractice as opTopUpPractice } from './practice.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;
    const value = createPractice(store, r.id);

    wake();

    return {
      id: value.id
    };
  });

export function createPractice(ctx: BackendContext, project: ProjectId): Practice {
  return ctx.transaction(() => {
    const existing = practice(ctx, project);

    if (existing) return existing;

    const t = now();
    const id = ctx.db.orm
      .insert(schema.practices)
      .values({
        project_id: project,
        created_at: t,
        updated_at: t
      })
      .run().lastInsertRowid as PracticeId;

    opTopUpPractice(ctx, id);

    return {
      id,
      projectId: project,
      createdAt: t,
      updatedAt: t
    };
  });
}

export function practice(ctx: BackendContext, project: ProjectId) {
  const r = ctx.db.orm
    .select()
    .from(schema.practices)
    .where(sql`project_id=${project}`)
    .get();

  return r
    ? {
        id: r.id,
        projectId: r.project_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    : null;
}
