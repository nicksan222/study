import { sql } from '@study/db';
import * as schema from '@study/db/schema';

import { titleOf } from '#server/procedures/projects/operations/common';
import type { ServerContext } from '#server/runtime/context';
import type { SessionId } from '#server/shared/ids';

export function setGeneratedTitle(ctx: ServerContext, id: SessionId, title: string): boolean {
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
  ctx: ServerContext,
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
