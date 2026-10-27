import * as schema from '@study/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { sessionRow } from '#backend/procedures/projects/projects';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { ChatSession } from '#backend/shared/conversations/sessions';
import type { SessionId } from '#backend/shared/ids';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store } = context;
    const found = session(store, r.id);

    return {
      value: found ? found : null
    };
  });

export function session(ctx: BackendContext, id: SessionId): ChatSession | null {
  const row = ctx.db.orm.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();

  return row ? sessionRow(row) : null;
}
