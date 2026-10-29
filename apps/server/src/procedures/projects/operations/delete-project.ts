import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import type { ProjectId } from '#server/shared/ids';

export function deleteProject(ctx: ServerContext, id: ProjectId): boolean {
  return ctx.transaction(
    () =>
      ctx.db.orm
        .delete(schema.projects)
        .where(sql`id = ${id}`)
        .run().changes !== 0n
  );
}
