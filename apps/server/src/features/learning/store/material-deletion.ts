/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Learning retires only slots and grading attempts owned by accepted Material scope. │
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

import { materialIdSchema, materialVersionIdSchema } from '@study/contracts/ids';
import { eq, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';
const inputIdsCodec = Schema.fromJsonString(
  Schema.toCodecJson(Schema.Array(materialVersionIdSchema))
);

export const LearningMaterialDeletionStore = defineStore({
  name: 'study/LearningMaterialDeletionStore',
  entity: { singular: 'learningMaterialDeletion', plural: 'learningMaterialDeletions' },
  make: ({ db }) => ({
    queries: {},
    mutations: {
      prepare: storeMutation({
        input: Schema.Array(materialIdSchema),
        output: Schema.Array(Schema.String),
        run: (ids) => {
          const versions = db.orm
            .select()
            .from(s.material_versions)
            .where(inArray(s.material_versions.material_id, [...ids]))
            .all()
            .map((v) => v.id);
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
          return [...new Set([...slots.map((p) => p.id), ...events.map((e) => e.correlationId)])];
        }
      }),
      scrub: storeMutation({
        input: Schema.Array(materialIdSchema),
        output: Schema.Void,
        run: (ids) => {
          const versions = db.orm
            .select()
            .from(s.material_versions)
            .where(inArray(s.material_versions.material_id, [...ids]))
            .all()
            .map((v) => v.id);
          db.orm
            .delete(s.material_quiz_attempts)
            .where(inArray(s.material_quiz_attempts.version_id, versions))
            .run();
          db.orm
            .delete(s.material_card_reviews)
            .where(inArray(s.material_card_reviews.version_id, versions))
            .run();
          const cards = db.orm
            .select()
            .from(s.material_card_identities)
            .where(inArray(s.material_card_identities.material_id, [...ids]))
            .all();
          db.orm
            .delete(s.material_card_schedules)
            .where(
              inArray(
                s.material_card_schedules.card_id,
                cards.map((c) => c.id)
              )
            )
            .run();
        }
      })
    }
  })
});
