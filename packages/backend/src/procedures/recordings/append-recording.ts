import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { now } from '#backend/procedures/conversations/post-message';
import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { RecordingId } from '#backend/shared/ids';

export const MAX_RECORDING_SAMPLES = 16000 * 60 * 60;

export const MAX_RECORDING_CHUNK_SAMPLES = 16000 * 60;

export const run = publicProcedure
  .input(
    z.object({
      id: idInput,
      samples: z.array(z.number().int().min(-32768).max(32767)).min(1).max(960000)
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;
    const id = r.id;

    if (
      r.samples.length > 960000 ||
      r.samples.some((n) => !Number.isInteger(n) || n < -32768 || n > 32767)
    )
      invalid('PCM samples out of range');

    appendRecording(store, id, Int16Array.from(r.samples));

    return {};
  });

export function appendRecording(ctx: BackendContext, id: RecordingId, samples: Int16Array): void {
  if (!samples.length || samples.length > MAX_RECORDING_CHUNK_SAMPLES)
    throw new StudyError('invalid_input', 'recording chunk size is invalid');

  const pcm = Buffer.alloc(samples.length * 2);

  samples.forEach((value, i) => pcm.writeInt16LE(value, i * 2));
  ctx.transaction(() => {
    const existing = ctx.db.orm.get<Record<string, unknown>>(
      sql`SELECT COALESCE(SUM(length(pcm)),0) AS size FROM recording_chunks WHERE recording_id=${id}`
    )!.size as bigint;

    if (existing + BigInt(pcm.length) > BigInt(MAX_RECORDING_SAMPLES * 2))
      throw new StudyError('invalid_input', 'recording is too large');

    ctx.db.orm.run(
      sql`INSERT INTO recording_chunks (recording_id,ordinal,pcm) VALUES (${id},(SELECT COALESCE(MAX(ordinal),-1)+1 FROM recording_chunks WHERE recording_id=${id}),${pcm})`
    );
    ctx.db.orm.run(sql`UPDATE recordings SET updated_at=${now()} WHERE id=${id}`);
  });
}
