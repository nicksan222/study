import type { SessionId, StudyDocumentVersionId } from '@study/contracts/ids';

import { defineTable, sql, text, integer, index, check } from '../schema-builder.ts';
import { sessions } from './conversations.ts';
import { study_document_versions } from './study-documents.ts';

/** Durable authored work intent. Publication receipts live in the authored version owner. */
export const study_document_transform_requests = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'study_document_transform_requests',
  {
    id: text().primaryKey(),
    context_request_id: text().notNull(),
    session_id: integer()
      .$type<SessionId>()
      .references(() => sessions.id, { onDelete: 'set null' }),
    request: text().notNull(),
    intent_hash: text().notNull(),
    instruction: text().notNull(),
    event_id: text().notNull(),
    cancelled: integer({ mode: 'boolean' }).notNull().default(false),
    error_kind: text(),
    result_version_id: integer()
      .$type<StudyDocumentVersionId>()
      .references(() => study_document_versions.id),
    report: text(),
    result_hash: text(),
    created_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    index('study_document_transform_sessions_idx').on(t.session_id, t.id),
    check('study_document_transform_request_check', sql`json_valid(${t.request})`),
    check(
      'study_document_transform_report_check',
      sql`${t.report} IS NULL OR json_valid(${t.report})`
    )
  ]
);
