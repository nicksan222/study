import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { ProjectId } from '#backend/shared/ids';

export function deleteProject(ctx: BackendContext, id: ProjectId): boolean {
  return ctx.transaction(
    () =>
      ctx.db.orm
        .delete(schema.projects)
        .where(sql`id = ${id}`)
        .run().changes !== 0n
  );
}
