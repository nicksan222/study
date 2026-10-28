import { sql } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { MessageId, VersionId } from '#backend/shared/ids';

export function setActiveVersion(
  ctx: BackendContext,
  message: MessageId,
  version: VersionId
): boolean {
  return ctx.transaction(() => {
    const changed =
      ctx.db.orm.run(
        sql`UPDATE messages SET active_version_id=${version} WHERE id=${message} AND EXISTS (SELECT 1 FROM message_versions WHERE id=${version} AND message_id=${message} AND status='complete')`
      ).changes !== 0n;

    return changed;
  });
}
