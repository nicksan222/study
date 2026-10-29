import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import type { SessionId } from '#server/shared/ids';

export function deleteSession(ctx: ServerContext, id: SessionId): boolean {
  return ctx.transaction(
    () =>
      ctx.db.orm
        .delete(schema.sessions)
        .where(sql`id = ${id}`)
        .run().changes !== 0n
  );
}
