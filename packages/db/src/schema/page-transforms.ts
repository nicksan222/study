import type { NoteId, PageVersionId } from '@study/contracts/ids';

import { defineTable, sql, text, integer, index, check } from '../schema-builder.ts';
import { notes } from './notes.ts';
import { page_versions } from './pages.ts';

/** Durable authored work intent. Publication receipts live in the authored version owner. */
export const page_transform_requests = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'page_transform_requests',
  {
    id: text().primaryKey(),
    context_request_id: text().notNull(),
    note_id: integer()
      .$type<NoteId>()
      .references(() => notes.id, { onDelete: 'set null' }),
    request: text().notNull(),
    intent_hash: text().notNull(),
    instruction: text().notNull(),
    event_id: text().notNull(),
    cancelled: integer({ mode: 'boolean' }).notNull().default(false),
    error_kind: text(),
    result_version_id: integer()
      .$type<PageVersionId>()
      .references(() => page_versions.id),
    report: text(),
    result_hash: text(),
    created_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    index('page_transform_notes_idx').on(t.note_id, t.id),
    check('page_transform_request_check', sql`json_valid(${t.request})`),
    check('page_transform_report_check', sql`${t.report} IS NULL OR json_valid(${t.report})`)
  ]
);
