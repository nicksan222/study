import { StudyError } from '@study/contracts/errors';
import { recordingIdSchema, sessionIdSchema } from '@study/contracts/ids';
import {
  appendRecordingInputSchema,
  postRecordingInputSchema,
  recordingPageInputSchema
} from '@study/contracts/recordings/rpc';
import { recordingPostSchema, recordingViewSchema } from '@study/contracts/recordings/schemas';
import { and, asc, desc, eq, lt, sql } from '@study/db';
import { recording_chunks, recording_posts, recordings, sessions } from '@study/db/schema';
import { Option, Schema } from 'effect';

import {
  encodeRecordingWav,
  MAX_RECORDING_SAMPLES
} from '#server/features/recordings/codecs/audio';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { finishRecordingPostInputSchema, recordingPostSnapshotSchema } from './schemas.ts';

const requestSchema = Schema.Struct({ requestId: Schema.String.check(Schema.isMinLength(1)) });

const required = <T>(value: T | null | undefined): T => {
  if (value == null) throw new StudyError('not_found', 'Recording missing');

  return value;
};

function makeHelpers({ db }: StoreResources) {
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
      sessionId: row.session_id,
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
      sessionId: row.session_id,
      sourceId: row.source_id,
      messageId: row.message_id
    };
  }

  function mutable(id: typeof recordingIdSchema.Type) {
    required(recording(id));

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

export const RecordingStore = defineStore({
  name: 'study/RecordingStore',
  entity: { singular: 'recording', plural: 'recordings' },
  make: ({ db, clock }) => {
    const { recording, mutable } = makeHelpers({ db, clock });

    return {
      queries: {
        recording: storeQuery({
          role: 'required',
          input: recordingIdSchema,
          output: recordingViewSchema,
          run: (id) => required(recording(id))
        }),
        findRecording: storeQuery({
          role: 'optional',
          input: recordingIdSchema,
          output: Schema.Option(recordingViewSchema),
          run: (id) => Option.fromNullishOr(recording(id))
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
          input: sessionIdSchema,
          output: recordingViewSchema,
          run: (id) => {
            required(db.orm.select().from(sessions).where(eq(sessions.id, id)).get());
            const at = unixSeconds(clock);
            const row = db.orm
              .insert(recordings)
              .values({ session_id: id, started_at: at, updated_at: at })
              .returning()
              .get();

            return required(recording(row.id));
          }
        }),
        appendRecording: storeMutation({
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
              .set({ updated_at: unixSeconds(clock) })
              .where(eq(recordings.id, id))
              .run();
          }
        }),
        deleteRecording: storeMutation({
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
});

export const RecordingPostStore = defineStore({
  name: 'study/RecordingPostStore',
  entity: { singular: 'recordingPost', plural: 'recordingPosts' },
  make: ({ db, clock }) => {
    const { recording, post } = makeHelpers({ db, clock });

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
          input: Schema.Struct({ ...postRecordingInputSchema.fields, requestId: Schema.String }),
          output: recordingPostSchema,
          run: (input) => {
            const record = required(recording(input.recording));

            if (record.sessionId !== input.session)
              throw new StudyError('invalid_input', 'Recording belongs to another session');

            const existing = db.orm
              .select()
              .from(recording_posts)
              .where(eq(recording_posts.recording_id, input.recording))
              .get();

            if (existing) {
              if (existing.name !== input.name.trim())
                throw new StudyError(
                  'invalid_input',
                  'Recording post differs from captured intent'
                );

              return post(existing.request_id);
            }

            const session = required(
              db.orm.select().from(sessions).where(eq(sessions.id, input.session)).get()
            );
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
                session_id: input.session,
                project_id: session.project_id,
                name: input.name.trim(),
                wav: Buffer.from(wav),
                duration_ms: BigInt(Math.round(Number(record.samples) / 16)),
                created_at: unixSeconds(clock)
              })
              .run();

            return post(input.requestId);
          }
        }),
        finishRecordingPost: storeMutation({
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
});

export const RecordingPostSnapshotStore = defineStore({
  name: 'study/RecordingPostSnapshotStore',
  entity: { singular: 'recordingPostSnapshot', plural: 'recordingPostSnapshots' },
  make: ({ db, clock }) => {
    const { post } = makeHelpers({ db, clock });

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
            const session = db.orm
              .select()
              .from(sessions)
              .where(eq(sessions.id, row.session_id))
              .get();

            if (!session || session.project_id !== row.project_id)
              throw new StudyError('invalid_input', 'Recording session is unavailable');

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
});
