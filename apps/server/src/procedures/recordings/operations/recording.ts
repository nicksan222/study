import * as schema from '@study/db/schema';
import { sql, eq } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { RecordingId } from '#server/shared/ids';
import type { Recording, RecordingView } from '#server/shared/recordings/schemas';

import { MAX_RECORDING_SAMPLES } from './append-recording.ts';

export function recording(ctx: ServerContext, id: RecordingId): Recording | null {
  const row = ctx.db.orm.select().from(schema.recordings).where(eq(schema.recordings.id, id)).get();

  return row
    ? {
        id,
        sessionId: row.session_id,
        startedAt: row.started_at,
        updatedAt: row.updated_at
      }
    : null;
}

export function recordingSamples(ctx: ServerContext, id: RecordingId): Int16Array {
  const size = ctx.db.orm.get<Record<string, unknown>>(
    sql`SELECT COALESCE(SUM(length(pcm)),0) AS size FROM recording_chunks WHERE recording_id=${id}`
  )!.size as bigint;

  if (size > BigInt(MAX_RECORDING_SAMPLES * 2))
    throw new StudyError('invalid_input', 'recording is too large');

  const chunks = ctx.db.orm.all<Record<string, unknown>>(
    sql`SELECT pcm FROM recording_chunks WHERE recording_id=${id} ORDER BY ordinal`
  );

  if (!ctx.db.orm.get<Record<string, unknown>>(sql`SELECT id FROM recordings WHERE id=${id}`))
    throw new StudyError('not_found', 'recording not found');

  const b = Buffer.concat(chunks.map((row) => Buffer.from(row.pcm as Uint8Array)));
  const samples = new Int16Array(b.length / 2);

  for (let i = 0; i < samples.length; i++) samples[i] = b.readInt16LE(i * 2);

  return samples;
}

export function recordingView(ctx: ServerContext, value: Recording): RecordingView {
  const count = ctx.db.orm
    .select({
      samples: sql<bigint>`coalesce(sum(length(${schema.recording_chunks.pcm})), 0) / 2`
    })
    .from(schema.recording_chunks)
    .where(eq(schema.recording_chunks.recording_id, value.id))
    .get()!;

  return { ...value, samples: count.samples };
}
