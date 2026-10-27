import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { PracticeId } from '#backend/shared/ids';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: deletePractice(store, r.id)
    };
  });

export function deletePractice(ctx: BackendContext, id: PracticeId): boolean {
  return ctx.transaction(() => {
    const removed =
      ctx.db.orm
        .delete(schema.practices)
        .where(sql`id=${id}`)
        .run().changes !== 0n;

    return removed;
  });
}
