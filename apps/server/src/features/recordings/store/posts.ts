/** @file Builds recordings posts queries and mutations with bound store resources. */

import { StudyError, postRecordingInputSchema, recordingPostSchema } from '@study/contracts';
import { asc, eq, notes, recording_chunks, recording_posts } from '@study/db';
import { storeMutation, storeQuery, unixSeconds } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { encodeRecordingWav } from '#server/features/recordings/codecs/audio';

import { makeHelpers, required } from './rows.ts';
import { finishRecordingPostInputSchema, recordingPostSnapshotSchema } from './schemas.ts';

const requestSchema = Schema.Struct({ requestId: Schema.String.check(Schema.isMinLength(1)) });

export function makeRecordingPostStore({ db, clock, timestampClock }: StoreResources) {
  const { recording, post, mutable } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      recordingPost: storeQuery({
        role: 'required',
        input: requestSchema,
        output: recordingPostSchema,
        run: ({ requestId }) => post(requestId)
      })
    },
    mutations: {
      captureRecordingPost: storeMutation({
        changes: ['recordings'],
        input: Schema.Struct({ ...postRecordingInputSchema.fields, requestId: Schema.String }),
        output: recordingPostSchema,
        run: (input) => {
          const record = required(recording(input.recording));

          if (record.noteId !== input.note)
            throw new StudyError('invalid_input', 'Recording belongs to another note');

          const existing = db.orm
            .select()
            .from(recording_posts)
            .where(eq(recording_posts.recording_id, input.recording))
            .get();

          if (existing) {
            if (existing.name !== input.name.trim())
              throw new StudyError('invalid_input', 'Recording post differs from captured intent');

            return post(existing.request_id);
          }

          mutable(input.recording);
          required(db.orm.select().from(notes).where(eq(notes.id, input.note)).get());
          const chunks = db.orm
            .select({ pcm: recording_chunks.pcm })
            .from(recording_chunks)
            .where(eq(recording_chunks.recording_id, input.recording))
            .orderBy(asc(recording_chunks.ordinal))
            .all();
          const wav = encodeRecordingWav(chunks.map(({ pcm }) => pcm));

          db.orm
            .insert(recording_posts)
            .values({
              request_id: input.requestId,
              recording_id: input.recording,
              note_id: input.note,
              project_id: null,
              name: input.name.trim(),
              wav: Buffer.from(wav),
              duration_ms: BigInt(Math.round(Number(record.samples) / 16)),
              created_at: unixSeconds(timestampClock)
            })
            .run();

          return post(input.requestId);
        }
      }),
      finishRecordingPost: storeMutation({
        changes: ['recordings'],
        input: finishRecordingPostInputSchema,
        output: recordingPostSchema,
        run: (input) => {
          const current = post(input.requestId);

          if (current.messageId !== null) {
            if (current.messageId !== input.messageId || current.sourceId !== input.sourceId)
              throw new StudyError('invalid_input', 'Recording result differs');

            return current;
          }

          db.orm
            .update(recording_posts)
            .set({ source_id: input.sourceId, message_id: input.messageId })
            .where(eq(recording_posts.request_id, input.requestId))
            .run();

          return post(input.requestId);
        }
      })
    }
  };
}

export function makeRecordingPostSnapshotStore({ db, clock, timestampClock }: StoreResources) {
  const { post } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      recordingPostSnapshot: storeQuery({
        role: 'required',
        input: requestSchema,
        output: recordingPostSnapshotSchema,
        run: ({ requestId }) => {
          const row = required(
            db.orm
              .select()
              .from(recording_posts)
              .where(eq(recording_posts.request_id, requestId))
              .get()
          );
          const note = db.orm.select().from(notes).where(eq(notes.id, row.note_id)).get();

          if (!note) throw new StudyError('invalid_input', 'Recording note is unavailable');

          return {
            ...post(requestId),
            projectId: row.project_id,
            name: row.name,
            bytes: new Uint8Array(row.wav),
            durationMs: Number(row.duration_ms)
          };
        }
      })
    },
    mutations: {}
  };
}
