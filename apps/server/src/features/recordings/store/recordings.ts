/** @file Builds recordings recordings queries and mutations with bound store resources. */

import {
  StudyError,
  appendRecordingInputSchema,
  noteIdSchema,
  recordingIdSchema,
  recordingPageInputSchema,
  recordingViewSchema
} from '@study/contracts';
import { and, desc, eq, lt, notes, recording_chunks, recordings, sql } from '@study/db';
import { storeMutation, storeQuery, unixSeconds } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { MAX_RECORDING_SAMPLES } from '#server/features/recordings/codecs/audio';

import { makeHelpers, required } from './rows.ts';

export function makeRecordingStore({ db, clock, timestampClock }: StoreResources) {
  const { recording, mutable } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      recording: storeQuery({
        role: 'required',
        input: recordingIdSchema,
        output: recordingViewSchema,
        run: (id) => required(recording(id))
      }),
      recordings: storeQuery({
        role: 'collection',
        input: recordingPageInputSchema,
        output: Schema.Array(recordingViewSchema),
        run: ({ limit, before }) =>
          db.orm
            .select({ id: recordings.id })
            .from(recordings)
            .where(
              and(
                sql`${recordings.sealed_at} IS NULL`,
                before === undefined ? undefined : lt(recordings.id, before),
                sql`NOT EXISTS (SELECT 1 FROM recording_posts p WHERE p.recording_id = ${recordings.id} AND p.message_id IS NOT NULL)`
              )
            )
            .orderBy(desc(recordings.id))
            .limit(limit)
            .all()
            .map(({ id }) => required(recording(id)))
      })
    },
    mutations: {
      createRecording: storeMutation({
        changes: ['recordings'],
        input: noteIdSchema,
        output: recordingViewSchema,
        run: (id) => {
          required(db.orm.select().from(notes).where(eq(notes.id, id)).get());
          const at = unixSeconds(timestampClock);
          const row = db.orm
            .insert(recordings)
            .values({ note_id: id, started_at: at, updated_at: at })
            .returning()
            .get();

          return required(recording(row.id));
        }
      }),
      appendRecording: storeMutation({
        changes: ['recordings'],
        input: appendRecordingInputSchema,
        output: Schema.Void,
        run: ({ id, samples }) => {
          mutable(id);
          const current = required(recording(id));

          if (current.samples + BigInt(samples.length) > BigInt(MAX_RECORDING_SAMPLES))
            throw new StudyError('invalid_input', 'Recording is too large');

          const last = db.orm
            .select({ ordinal: recording_chunks.ordinal })
            .from(recording_chunks)
            .where(eq(recording_chunks.recording_id, id))
            .orderBy(desc(recording_chunks.ordinal))
            .limit(1)
            .get();
          const pcm = Buffer.alloc(samples.length * 2);

          samples.forEach((sample, i) => pcm.writeInt16LE(sample, i * 2));
          db.orm
            .insert(recording_chunks)
            .values({ recording_id: id, ordinal: last ? last.ordinal + 1n : 0n, pcm })
            .run();
          db.orm
            .update(recordings)
            .set({ updated_at: unixSeconds(timestampClock) })
            .where(eq(recordings.id, id))
            .run();
        }
      }),
      deleteRecording: storeMutation({
        changes: ['recordings'],
        input: recordingIdSchema,
        output: Schema.Boolean,
        run: (id) => {
          if (!recording(id)) return false;

          mutable(id);

          return (
            db.orm.delete(recordings).where(eq(recordings.id, id)).returning().all().length > 0
          );
        }
      })
    }
  };
}
