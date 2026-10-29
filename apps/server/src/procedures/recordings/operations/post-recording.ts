import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { postMessage } from '#server/procedures/conversations/operations/post-message';
import { session as opSession } from '#server/procedures/conversations/operations/session';
import { storeSource as opStoreSource } from '#server/procedures/sources/operations/upload-source';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { RecordingId } from '#server/shared/ids';

import { deleteRecording } from './delete-recording.ts';
import { recording, recordingSamples } from './recording.ts';

export function postRecording(ctx: ServerContext, id: RecordingId, name: string) {
  return ctx.transaction(() => {
    const recordingValue = recording(ctx, id);

    if (!recordingValue) throw new StudyError('not_found', 'recording not found');

    const samples = recordingSamples(ctx, id);

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
    const session = opSession(ctx, recordingValue.sessionId);

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
        sessionId: recordingValue.sessionId,
        durationMs: BigInt(Math.round(samples.length / 16)),
        sampleRate: 16000n,
        channels: 1n
      }
    );
    const message = postMessage(ctx, {
      sessionId: recordingValue.sessionId,
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

    deleteRecording(ctx, id);

    return message;
  });
}
