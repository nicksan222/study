import * as schema from '@study/db/schema';
import { desc } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';

import { practiceScore as opPracticeScore } from './practice.ts';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store } = context;

  return {
    items: listPractices(store)
  };
});

export function listPractices(ctx: BackendContext) {
  return ctx.db.orm
    .select()
    .from(schema.practices)
    .orderBy(desc(schema.practices.updated_at), desc(schema.practices.id))
    .all()
    .map((r) => ({
      id: r.id,
      projectId: r.project_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      score: opPracticeScore(ctx, r.id)
    }));
}
