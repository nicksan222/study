import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { messageView } from '#backend/procedures/conversations/messages';
import { postMessage as opPostMessage } from '#backend/procedures/conversations/post-message';
import { session as opSession } from '#backend/procedures/conversations/session';
import { enqueueJob } from '#backend/procedures/jobs/worker';
import { source as opSource } from '#backend/procedures/sources/source';
import { storeSource as opStoreSource } from '#backend/procedures/sources/upload-source';
import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { RecordingId } from '#backend/shared/ids';

import { deleteRecording as opDeleteRecording } from './delete-recording.ts';
import { recording as opRecording, recordingSamples as opRecordingSamples } from './recording.ts';

export const run = publicProcedure
  .input(
    z.object({
      session: idInput,
      recording: idInput,
      name: z.string()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;
    const id = r.recording;
    const recording = opRecording(store, id);

    if (!recording) throw new StudyError('not_found', 'Recording missing');

    if (recording.sessionId !== r.session) invalid('Recording belongs to another session');

    const posted = store.transaction(() => {
      const result = postRecording(store, id, r.name);

      for (const part of result.parts)
        if (part.sourceId) {
          const source = opSource(store, part.sourceId);

          if (source)
            enqueueJob(store, { kind: 'extract', target: { type: 'source', id: source.id } });
        }

      return result;
    });

    wake();

    return messageView(store, posted);
  });

export function postRecording(ctx: BackendContext, id: RecordingId, name: string) {
  return ctx.transaction(() => {
    const recording = opRecording(ctx, id);

    if (!recording) throw new StudyError('not_found', 'recording not found');

    const samples = opRecordingSamples(ctx, id);

    if (!samples.length) throw new StudyError('invalid_input', 'recording is empty');

    const wav = Buffer.alloc(44 + samples.length * 2);

    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(samples.length * 2, 40);
    samples.forEach((value, i) => wav.writeInt16LE(value, 44 + i * 2));
    const session = opSession(ctx, recording.sessionId);

    if (!session) throw new StudyError('not_found', 'session not found');

    const source = opStoreSource(
      ctx,
      {
        name,
        bytes: wav,
        kind: 'audio',
        mime: 'audio/wav',
        origin: 'recording',
        projectId: session.projectId
      },
      {
        sessionId: recording.sessionId,
        durationMs: BigInt(Math.round(samples.length / 16)),
        sampleRate: 16000n,
        channels: 1n
      }
    );
    const message = opPostMessage(ctx, {
      sessionId: recording.sessionId,
      text: '',
      attachments: [source.id]
    });

    ctx.db.orm
      .update(schema.messages)
      .set({
        recorded_in: source.id
      })
      .where(sql`recording_id=${id}`)
      .run();

    opDeleteRecording(ctx, id);

    return message;
  });
}
