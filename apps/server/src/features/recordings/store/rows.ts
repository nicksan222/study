/** @file Owns rows within this feature. */

import type { recordingIdSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import { eq, recording_chunks, recording_posts, recordings, sql } from '@study/db';
import type { StoreResources } from '@study/server';

export const required = <T>(value: T | null | undefined): T => {
  if (value == null) throw new StudyError('not_found', 'Recording missing');

  return value;
};

export function makeHelpers({ db }: StoreResources) {
  function recording(id: typeof recordingIdSchema.Type) {
    const row = db.orm.select().from(recordings).where(eq(recordings.id, id)).get();

    if (!row) return undefined;

    const sum = db.orm
      .select({ samples: sql<bigint>`COALESCE(SUM(length(${recording_chunks.pcm})),0)/2` })
      .from(recording_chunks)
      .where(eq(recording_chunks.recording_id, id))
      .get();

    return {
      id: row.id,
      noteId: row.note_id,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      samples: sum?.samples ?? 0n
    };
  }

  function post(requestId: string) {
    const row = required(
      db.orm.select().from(recording_posts).where(eq(recording_posts.request_id, requestId)).get()
    );

    return {
      requestId: row.request_id,
      recordingId: row.recording_id,
      noteId: row.note_id,
      sourceId: row.source_id,
      messageId: row.message_id
    };
  }

  function mutable(id: typeof recordingIdSchema.Type) {
    required(recording(id));
    const row = db.orm.select().from(recordings).where(eq(recordings.id, id)).get();

    if (row?.sealed_at !== null) throw new StudyError('invalid_input', 'Recording is sealed');

    if (
      db.orm
        .select({ id: recording_posts.request_id })
        .from(recording_posts)
        .where(eq(recording_posts.recording_id, id))
        .get()
    )
      throw new StudyError('invalid_input', 'Recording has been captured for posting');
  }

  return { recording, post, mutable };
}
