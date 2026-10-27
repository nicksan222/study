import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ProjectId } from '#backend/shared/ids';

import { nameOf, now } from './projects.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput,
      name: z.string()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: renameProject(store, r.id, r.name)
    };
  });

export function renameProject(ctx: BackendContext, id: ProjectId, value: string): boolean {
  return (
    ctx.db.orm
      .update(schema.projects)
      .set({
        name: nameOf(value),
        updated_at: now()
      })
      .where(sql`id = ${id}`)
      .run().changes !== 0n
  );
}
