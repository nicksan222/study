/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Counts logical history body columns without claiming physical SQLite reclamation.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Includes selected payload text and obsolete Document body columns.                     │
 * │ - Leaves shared source BLOB ownership accounting to the Sources participant.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ These counts describe stored columns and exclude private native payload and index sizes. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialVersionId } from '@study/contracts/ids';
import { inArray, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

/** Logical stored UTF-8 body bytes, excluding SQLite row/index overhead and retained copies. */

/** Counts feature-owned text bodies before history retention scrubs their content. */
export function makeHistoryBodyBytes({ db }: StoreResources) {
  /** Includes ordering step text in logical history-retention byte accounting. */
  function quizPayloads(ids: readonly MaterialVersionId[]) {
    const payloads: (string | null)[] = [];

    for (const q of db.orm
      .select()
      .from(s.material_quiz_questions)
      .where(inArray(s.material_quiz_questions.version_id, [...ids]))
      .all()) {
      payloads.push(q.prompt, q.explanation);

      for (const item of db.orm
        .select()
        .from(s.material_quiz_ordering_items)
        .where(eq(s.material_quiz_ordering_items.question_id, q.id))
        .all())
        payloads.push(item.text);

      for (const c of db.orm
        .select()
        .from(s.material_quiz_choices)
        .where(eq(s.material_quiz_choices.question_id, q.id))
        .all())
        payloads.push(c.text);

      payloads.push(
        db.orm
          .select()
          .from(s.material_quiz_open_answers)
          .where(eq(s.material_quiz_open_answers.question_id, q.id))
          .get()?.reference_answer ?? null
      );
    }

    return payloads;
  }

  return (ids: readonly MaterialVersionId[]) => {
    const payloads: (string | null)[] = [];
    const versions = db.orm
      .select()
      .from(s.material_versions)
      .where(inArray(s.material_versions.id, [...ids]))
      .all();

    for (const v of versions) payloads.push(v.instruction, v.language);

    for (const r of db.orm
      .select()
      .from(s.material_diagram_versions)
      .where(inArray(s.material_diagram_versions.version_id, [...ids]))
      .all())
      payloads.push(r.payload);

    for (const c of db.orm
      .select()
      .from(s.material_flashcard_entries)
      .where(inArray(s.material_flashcard_entries.version_id, [...ids]))
      .all())
      payloads.push(c.front, c.back);

    payloads.push(...quizPayloads(ids));

    return payloads.reduce<bigint>(
      (total, value) => total + BigInt(value === null ? 0 : Buffer.byteLength(value)),
      0n
    );
  };
}
