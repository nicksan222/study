import * as schema from '@study/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { MessageId } from '#backend/shared/ids';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return {
      value: deleteMessage(store, r.id)
    };
  });

export function deleteMessage(ctx: BackendContext, id: MessageId): boolean {
  return ctx.transaction(() => {
    const changed =
      ctx.db.orm.delete(schema.messages).where(eq(schema.messages.id, id)).run().changes !== 0n;

    return changed;
  });
}
