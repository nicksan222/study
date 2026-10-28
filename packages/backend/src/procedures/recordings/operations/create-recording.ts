import { sql } from 'drizzle-orm';

import { now } from '#backend/procedures/conversations/operations/post-message';
import type { BackendContext } from '#backend/runtime/context';
import type { RecordingId, SessionId } from '#backend/shared/ids';
import type { Recording } from '#backend/shared/recordings/schemas';

export function createRecording(ctx: BackendContext, sessionId: SessionId): Recording {
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
