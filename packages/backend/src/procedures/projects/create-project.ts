import * as schema from '@study/db/schema';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import type { ProjectId } from '#backend/shared/ids';
import type { Project } from '#backend/shared/projects/types';

import { nameOf, now } from './projects.ts';

export const run = publicProcedure
  .input(
    z.object({
      name: z.string()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return createProject(store, r.name);
  });

export function createProject(ctx: BackendContext, value: string): Project {
  const name = nameOf(value),
    timestamp = now();
  const result = ctx.db.orm
    .insert(schema.projects)
    .values({
      name: name,
      created_at: timestamp,
      updated_at: timestamp
    })
    .run();

  return {
    id: result.lastInsertRowid as ProjectId,
    name,
    examOn: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
