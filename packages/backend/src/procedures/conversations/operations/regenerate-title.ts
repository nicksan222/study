import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { titleOf } from '#backend/procedures/projects/operations/common';
import type { BackendContext } from '#backend/runtime/context';
import type { SessionId } from '#backend/shared/ids';

export function setGeneratedTitle(ctx: BackendContext, id: SessionId, title: string): boolean {
  return (
    ctx.db.orm
      .update(schema.sessions)
      .set({
        title: titleOf(title),
        title_source: 'generated'
      })
      .where(sql`id = ${id} AND title_source = 'provisional'`)
      .run().changes !== 0n
  );
}

export function replaceWithGeneratedTitle(
  ctx: BackendContext,
  id: SessionId,
  title: string
): boolean {
  return (
    ctx.db.orm
      .update(schema.sessions)
      .set({
        title: titleOf(title),
        title_source: 'generated'
      })
      .where(sql`id = ${id}`)
      .run().changes !== 0n
  );
}
