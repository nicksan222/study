import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import type { ProjectId } from '#server/shared/ids';

import { nameOf, now } from './common.ts';

export function renameProject(ctx: ServerContext, id: ProjectId, value: string): boolean {
  return (
    ctx.db.orm
      .update(schema.projects)
      .set({ name: nameOf(value), updated_at: now() })
      .where(sql`id = ${id}`)
      .run().changes !== 0n
  );
}
