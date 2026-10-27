import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ProjectId } from '#backend/shared/ids';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: deleteProject(store, r.id)
    };
  });

export function deleteProject(ctx: BackendContext, id: ProjectId): boolean {
  return ctx.transaction(
    () =>
      ctx.db.orm
        .delete(schema.projects)
        .where(sql`id = ${id}`)
        .run().changes !== 0n
  );
}
