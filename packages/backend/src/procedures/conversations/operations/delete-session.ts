import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { SessionId } from '#backend/shared/ids';

export function deleteSession(ctx: BackendContext, id: SessionId): boolean {
  return ctx.transaction(
    () =>
      ctx.db.orm
        .delete(schema.sessions)
        .where(sql`id = ${id}`)
        .run().changes !== 0n
  );
}
