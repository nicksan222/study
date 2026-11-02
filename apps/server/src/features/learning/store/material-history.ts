/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Learning retires only slots and grading attempts owned by accepted exact version scope. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact history behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { materialVersionIdSchema } from '@study/contracts/ids';
import { eq, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

const inputIdsCodec = Schema.fromJsonString(
  Schema.toCodecJson(Schema.Array(materialVersionIdSchema))
);

export const LearningMaterialHistoryStore = defineStore({
  name: 'study/LearningMaterialHistoryStore',
  entity: { singular: 'learningMaterialHistory', plural: 'learningMaterialHistories' },
  make: (resources) => {
    const { db } = resources;

    function inspect(versions: readonly (typeof materialVersionIdSchema.Type)[]) {
      const attempts = db.orm
        .select()
        .from(s.material_quiz_attempts)
        .where(inArray(s.material_quiz_attempts.version_id, versions))
        .all();

      const slots = db.orm
        .select()
        .from(s.learning_practice_slots)
        .all()
        .filter(
          (p) =>
            (p.version_id !== null && versions.includes(p.version_id)) ||
            (p.status === 'pending' &&
              Schema.decodeUnknownSync(inputIdsCodec)(p.input_version_ids).some((v) =>
                versions.some((id) => id === v)
              ))
        );

      const events = db.orm
        .select()
        .from(s.workflowEvents)
        .where(
          inArray(
            sql<string>`json_extract(${s.workflowEvents.payload}, '$.attemptId')`,
            attempts.map((a) => String(a.id))
          )
        )
        .all();

      return {
        attempts,
        slots,
        events,
        requestIds: [...new Set([...slots.map((p) => p.id), ...events.map((e) => e.correlationId)])]
      };
    }
    return {
      queries: {
        learningMaterialHistory: storeQuery({
          role: 'required',
          input: Schema.Array(materialVersionIdSchema),
          output: Schema.Struct({ token: Schema.String, requestIds: Schema.Array(Schema.String) }),
          run: (ids) => {
            const value = inspect(ids);
            return {
              token: createHash('sha256')
                .update(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v)))
                .digest('hex'),
              requestIds: value.requestIds
            };
          }
        })
      },
      mutations: {
        prepare: storeMutation({
          input: Schema.Array(materialVersionIdSchema),
          output: Schema.Array(Schema.String),
          run: (ids) => {
            const versions = ids;

            const { slots, requestIds } = inspect(versions);
            for (const p of slots) {
              const ownsOutput = p.version_id !== null && versions.includes(p.version_id);

              db.orm
                .update(s.learning_practice_slots)
                .set({
                  status: 'cancelled',
                  ...(ownsOutput ? { version_id: null, attempt_id: null } : {})
                })
                .where(eq(s.learning_practice_slots.id, p.id))
                .run();
            }

            return requestIds;
          }
        }),
        scrub: storeMutation({
          input: Schema.Array(materialVersionIdSchema),
          output: Schema.Void,
          run: (ids) => {
            const versions = ids;

            db.orm
              .delete(s.material_quiz_attempts)
              .where(inArray(s.material_quiz_attempts.version_id, versions))
              .run();

            db.orm
              .delete(s.material_card_reviews)
              .where(inArray(s.material_card_reviews.version_id, versions))
              .run();
          }
        })
      }
    };
  }
});
