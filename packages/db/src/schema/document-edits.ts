/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Declares retained Document edit, proposal and application records.               │
 * │                                                                                        │
 * │ Responsibilities:                                                                      │
 * │ - Keeps exact revision identities without owning library content deletion.             │
 * │                                                                                        │
 * │ Boundaries:                                                                            │
 * │ Drizzle owns schema; Materials and Conversations own domain policy.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialId, MaterialVersionId, SessionId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import {
  integer,
  text,
  sqliteTable,
  primaryKey,
  uniqueIndex,
  check,
  foreignKey
} from 'drizzle-orm/sqlite-core';

import { materials, material_versions, material_generation_requests } from './material-versions.ts';

/** Retains exact autosave alternatives and canonical idempotent intent across reopen. */
export const document_edit_receipts = sqliteTable(
  'document_edit_receipts',
  {
    material_id: integer()
      .$type<MaterialId>()
      .notNull()
      .references(() => materials.id),
    key: text().notNull(),
    operation: text({ enum: ['save', 'undo'] }).notNull(),
    intent: text().notNull(),
    expected_version_id: integer()
      .$type<MaterialVersionId>()
      .notNull()
      .references(() => material_versions.id),
    current_version_id: integer()
      .$type<MaterialVersionId>()
      .notNull()
      .references(() => material_versions.id),
    submitted_version_id: integer()
      .$type<MaterialVersionId>()
      .notNull()
      .references(() => material_versions.id),
    outcome: text({ enum: ['saved', 'conflict'] }).notNull()
  },
  (t) => [
    primaryKey({ columns: [t.material_id, t.key] }),
    uniqueIndex('document_edit_receipts_submitted_unique').on(t.submitted_version_id),
    check(
      'document_edit_intent_check',
      sql`json_valid(${t.intent}) AND length(${t.key}) BETWEEN 1 AND 200`
    ),
    check(
      'document_edit_outcome_check',
      sql`${t.operation} IN ('save','undo') AND ${t.outcome} IN ('saved','conflict') AND (${t.outcome} != 'saved' OR ${t.expected_version_id} = ${t.current_version_id})`
    ),
    ...[t.expected_version_id, t.current_version_id, t.submitted_version_id].map((version) =>
      foreignKey({
        columns: [version, t.material_id],
        foreignColumns: [material_versions.id, material_versions.material_id]
      })
    )
  ]
);

/** Session ownership fences proposal actions without owning any library Material. */
export const document_proposals = sqliteTable('document_proposals', {
  request_id: text()
    .primaryKey()
    .references(() => material_generation_requests.id),
  session_id: integer().$type<SessionId>().notNull(),
  base_version_id: integer()
    .$type<MaterialVersionId>()
    .notNull()
    .references(() => material_versions.id),
  proposed_version_id: integer()
    .unique()
    .$type<MaterialVersionId>()
    .notNull()
    .references(() => material_versions.id)
});

/** A key identifies one typed apply/keep intent; no cascade can remove published results. */
export const document_proposal_receipts = sqliteTable(
  'document_proposal_receipts',
  {
    key: text().primaryKey(),
    request_id: text()
      .notNull()
      .references(() => document_proposals.request_id),
    operation: text({ enum: ['apply', 'keep'] }).notNull(),
    intent: text().notNull(),
    outcome: text({ enum: ['applied', 'kept', 'conflict'] }).notNull(),
    current_version_id: integer()
      .$type<MaterialVersionId>()
      .notNull()
      .references(() => material_versions.id),
    result_version_id: integer()
      .$type<MaterialVersionId>()
      .references(() => material_versions.id)
  },
  (t) => [
    uniqueIndex('document_proposal_receipts_completed_unique')
      .on(t.request_id, t.operation)
      .where(sql`${t.result_version_id} IS NOT NULL`),
    check(
      'document_proposal_receipt_intent_check',
      sql`json_valid(${t.intent}) AND length(${t.key}) BETWEEN 1 AND 200`
    ),
    check(
      'document_proposal_receipt_outcome_check',
      sql`(${t.outcome} = 'conflict' AND ${t.operation} = 'apply' AND ${t.result_version_id} IS NULL) OR (${t.outcome} = 'applied' AND ${t.operation} = 'apply' AND ${t.result_version_id} IS NOT NULL) OR (${t.outcome} = 'kept' AND ${t.operation} = 'keep' AND ${t.result_version_id} IS NOT NULL)`
    )
  ]
);

/** Exact session ownership permits prompt retirement without deleting library results. */
export const session_generation_retirements = sqliteTable('session_generation_retirements', {
  request_id: text()
    .primaryKey()
    .references(() => material_generation_requests.id),
  session_id: integer().$type<SessionId>().notNull()
});

/** Completed proposal outcomes retain identities only, independent of the removed draft. */
export const retired_document_proposal_receipts = sqliteTable(
  'retired_document_proposal_receipts',
  {
    key: text().primaryKey(),
    intent_hash: text().notNull(),
    current_version_id: integer().$type<MaterialVersionId>().notNull(),
    proposed_version_id: integer().$type<MaterialVersionId>().notNull(),
    request_id: text().notNull(),
    operation: text({ enum: ['apply', 'keep'] }).notNull(),
    outcome: text({ enum: ['applied', 'kept'] }).notNull(),
    base_version_id: integer().$type<MaterialVersionId>().notNull(),
    result_version_id: integer()
      .$type<MaterialVersionId>()
      .notNull()
      .references(() => material_versions.id)
  }
);
