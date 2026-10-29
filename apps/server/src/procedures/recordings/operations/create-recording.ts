import { sql } from '@study/db';

import { now } from '#server/procedures/conversations/operations/post-message';
import type { ServerContext } from '#server/runtime/context';
import type { RecordingId, SessionId } from '#server/shared/ids';
import type { Recording } from '#server/shared/recordings/schemas';

export function createRecording(ctx: ServerContext, sessionId: SessionId): Recording {
  return ctx.transaction(() => {
    const at = now();
    const id = ctx.db.orm.run(
      sql`INSERT INTO recordings (session_id,started_at,updated_at) VALUES (${sessionId},${at},${at})`
    ).lastInsertRowid as RecordingId;

    return {
      id,
      sessionId,
      startedAt: at,
      updatedAt: at
    };
  });
}
