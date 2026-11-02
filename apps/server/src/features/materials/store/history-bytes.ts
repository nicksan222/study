/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Material deletion owns exact scope, barriers and content retirement; native        │
 * │ Workflow owns execution.                                                                 │
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

import type { MaterialVersionId } from '@study/contracts/ids';
import { inArray, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

/** Logical stored UTF-8 body bytes, excluding SQLite row/index overhead and retained copies. */
export function historyBodyBytes({ db }: StoreResources, ids: readonly MaterialVersionId[]) {
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
  const docs = db.orm
    .select()
    .from(s.material_document_versions)
    .where(inArray(s.material_document_versions.version_id, [...ids]))
    .all()
    .map((r) => r.document_id);
  for (const pin of db.orm
    .select()
    .from(s.material_source_snapshots)
    .where(inArray(s.material_source_snapshots.version_id, [...ids]))
    .all()) {
    payloads.push(pin.metadata);
    if (pin.document_id !== null && !docs.includes(pin.document_id)) docs.push(pin.document_id);
  }
  for (const id of docs) {
    const current = db.orm
      .select()
      .from(s.source_processing)
      .where(eq(s.source_processing.document_id, id))
      .get();
    if (current) continue;
    payloads.push(
      db.orm.select().from(s.documents).where(eq(s.documents.id, id)).get()?.meta ?? null
    );
    for (const b of db.orm.select().from(s.blocks).where(eq(s.blocks.document_id, id)).all())
      payloads.push(b.text, b.content, b.anchor);
    for (const c of db.orm.select().from(s.chunks).where(eq(s.chunks.document_id, id)).all())
      payloads.push(c.text, c.anchor);
  }
  for (const q of db.orm
    .select()
    .from(s.material_quiz_questions)
    .where(inArray(s.material_quiz_questions.version_id, [...ids]))
    .all()) {
    payloads.push(q.prompt, q.explanation);
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
  for (const c of db.orm
    .select()
    .from(s.material_flashcard_entries)
    .where(inArray(s.material_flashcard_entries.version_id, [...ids]))
    .all())
    payloads.push(c.front, c.back);
  return payloads.reduce<bigint>(
    (total, value) => total + BigInt(value === null ? 0 : Buffer.byteLength(value)),
    0n
  );
}
