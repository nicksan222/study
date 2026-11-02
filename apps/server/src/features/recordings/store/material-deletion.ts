/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retires private WAV captures while retaining published message-owned recordings.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { materialIdSchema, sourceIdSchema } from '@study/contracts/ids';
import { eq, inArray, or } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';

export const RecordingMaterialImpactStore = defineStore({
  name: 'study/RecordingMaterialImpactStore',
  entity: { singular: 'recordingMaterialImpact', plural: 'recordingMaterialImpacts' },
  make: ({ db }) => ({
    queries: {
      recordingMaterialImpact: storeQuery({
        role: 'required',
        input: Schema.Array(sourceIdSchema),
        output: Schema.Struct({ requestIds: Schema.Array(Schema.String), token: Schema.String }),
        run: (ids) => {
          const rows = db.orm
            .select()
            .from(s.recording_posts)
            .where(
              or(
                inArray(s.recording_posts.source_id, [...ids]),
                inArray(
                  s.recording_posts.request_id,
                  db.orm
                    .select({ id: s.source_recording_imports.request_id })
                    .from(s.source_recording_imports)
                    .where(inArray(s.source_recording_imports.source_id, [...ids]))
                )
              )
            )
            .all();

          return {
            requestIds: rows.map((r) => r.request_id),
            token: createHash('sha256')
              .update(JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? String(v) : v)))
              .digest('hex')
          };
        }
      })
    },
    mutations: {}
  })
});

export const RecordingMaterialDeletionStore = defineStore({
  name: 'study/RecordingMaterialDeletionStore',
  entity: { singular: 'recordingMaterialDeletion', plural: 'recordingMaterialDeletions' },
  make: ({ db }) => ({
    queries: {},
    mutations: {
      scrub: storeMutation({
        input: materialIdSchema,
        output: Schema.Void,
        run: (id) => {
          const ids = db.orm
            .select()
            .from(s.material_deletion_requests)
            .where(eq(s.material_deletion_requests.deletion_id, id))
            .all()
            .map((r) => r.request_id);

          for (const requestId of ids) {
            const post = db.orm
              .select()
              .from(s.recording_posts)
              .where(eq(s.recording_posts.request_id, requestId))
              .get();

            if (post?.message_id === null)
              db.orm
                .delete(s.recording_chunks)
                .where(eq(s.recording_chunks.recording_id, post.recording_id))
                .run();

            db.orm
              .update(s.recording_posts)
              .set({ name: '-', wav: Buffer.alloc(46), duration_ms: 0n })
              .where(eq(s.recording_posts.request_id, requestId))
              .run();
          }
        }
      })
    }
  })
});
