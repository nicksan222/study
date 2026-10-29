import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import type { PracticeId } from '#server/shared/ids';

export function deletePractice(ctx: ServerContext, id: PracticeId): boolean {
  return ctx.transaction(
    () =>
      ctx.db.orm
        .delete(schema.practices)
        .where(sql`id=${id}`)
        .run().changes !== 0n
  );
}
