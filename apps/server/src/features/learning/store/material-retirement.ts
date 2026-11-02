/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retires practice slots and answers tied to exact historical Material versions.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Includes pending input dependencies and completed version-specific attempts.           │
 * │ - Keeps unrelated schedules and stable card identities outside version cleanup.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Learning owns practice persistence; native retirement handles correlated private         │
 * │ payloads.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { materialVersionIdSchema } from '@study/contracts/ids';
import { eq, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';

const inputIdsCodec = Schema.fromJsonString(
  Schema.toCodecJson(Schema.Array(materialVersionIdSchema))
);

export function makeMaterialRetirement({ db }: StoreResources) {
  function inspect(versions: readonly (typeof materialVersionIdSchema.Type)[]) {
    const attempts = db.orm
      .select({ id: s.material_quiz_attempts.id, versionId: s.material_quiz_attempts.version_id })
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
              versions.includes(v)
            ))
      );

    const events = db.orm
      .select({ eventId: s.workflowEvents.eventId, correlationId: s.workflowEvents.correlationId })
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

  function cancelSlots(versions: readonly (typeof materialVersionIdSchema.Type)[]) {
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

  function scrubVersions(versions: readonly (typeof materialVersionIdSchema.Type)[]) {
    db.orm
      .delete(s.material_quiz_attempts)
      .where(inArray(s.material_quiz_attempts.version_id, versions))
      .run();

    db.orm
      .delete(s.material_card_reviews)
      .where(inArray(s.material_card_reviews.version_id, versions))
      .run();
  }

  return { inspect, cancelSlots, scrubVersions };
}
