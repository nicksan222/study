import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { now } from '#backend/procedures/conversations/post-message';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { Recording } from '#backend/shared/conversations/messages';
import type { SessionId } from '#backend/shared/ids';
import type { RecordingId } from '#backend/shared/ids';

import { recordingView } from './recording.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    return recordingView(store, createRecording(store, r.id));
  });

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
