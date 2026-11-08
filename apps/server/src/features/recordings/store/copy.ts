/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists recording chunks and posting state in SQLite, and builds recording views  │
 * │ and WAV exports from stored PCM.                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature stores own SQLite access and map rows to typed contracts.                      │
 * │ - Queries or mutates feature-owned database records.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps SQL and schema mapping behind typed store operations.                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { copyNoteContentSchema, recordingCopySchema } from '@study/contracts/notes/notes';
import { eq, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';

export const RecordingCopyStore = defineStore({
  name: 'study/RecordingCopyStore',
  entity: { singular: 'recordingCopy', plural: 'recordingCopies' },
  make: ({ db }) => ({
    queries: {},
    mutations: {
      copy: storeMutation({
        input: copyNoteContentSchema,
        output: Schema.Array(recordingCopySchema),
        run: ({ noteIds: ids, targetNoteId: target }) => {
          const copies: Array<typeof recordingCopySchema.Type> = [];

          for (const old of db.orm
            .select()
            .from(s.recordings)
            .where(inArray(s.recordings.note_id, ids))
            .all()) {
            const post = db.orm
              .select()
              .from(s.recording_posts)
              .where(eq(s.recording_posts.recording_id, old.id))
              .get();

            if (old.sealed_at === null && !post?.message_id)
              throw new StudyError(
                'invalid_input',
                'Finish or discard recordings before merging notes'
              );

            const { id, ...values } = old;
            const created = db.orm
              .insert(s.recordings)
              .values({ ...values, note_id: target, sealed_at: old.updated_at })
              .returning()
              .get();

            copies.push({ originalId: id, copiedId: created.id });

            for (const { id: _id, ...chunk } of db.orm
              .select()
              .from(s.recording_chunks)
              .where(eq(s.recording_chunks.recording_id, id))
              .all())
              db.orm
                .insert(s.recording_chunks)
                .values({ ...chunk, recording_id: created.id })
                .run();
          }

          return copies;
        }
      })
    }
  })
});
