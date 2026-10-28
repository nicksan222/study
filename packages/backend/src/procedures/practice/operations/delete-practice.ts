import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { PracticeId } from '#backend/shared/ids';

export function deletePractice(ctx: BackendContext, id: PracticeId): boolean {
  return ctx.transaction(
    () =>
      ctx.db.orm
        .delete(schema.practices)
        .where(sql`id=${id}`)
        .run().changes !== 0n
  );
}
