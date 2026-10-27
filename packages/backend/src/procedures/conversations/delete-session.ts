import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { SessionId } from '#backend/shared/ids';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: deleteSession(store, r.id)
    };
  });

export function deleteSession(ctx: BackendContext, id: SessionId): boolean {
  return ctx.transaction(
    () =>
      ctx.db.orm
        .delete(schema.sessions)
        .where(sql`id = ${id}`)
        .run().changes !== 0n
  );
}
