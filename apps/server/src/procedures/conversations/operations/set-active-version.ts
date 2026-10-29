import { sql } from '@study/db';

import type { ServerContext } from '#server/runtime/context';
import type { MessageId, VersionId } from '#server/shared/ids';

export function setActiveVersion(
  ctx: ServerContext,
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
