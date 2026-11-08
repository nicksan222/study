import type { PageVersionId, SourceId, ContentSnapshotId, NoteId } from '@study/contracts/ids';

import { defineTable, text, integer, primaryKey, foreignKey } from '../schema-builder.ts';
import { note_run_contexts } from './notes.ts';
import { page_versions } from './pages.ts';
import { source_extraction_revisions } from './source-processing.ts';

/** Exact captures pin inputs until the owning private capture is explicitly retired. */
export const note_context_pages = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'note_context_pages',
  {
    request_id: text()
      .notNull()
      .references(() => note_run_contexts.request_id, { onDelete: 'cascade' }),
    version_id: integer()
      .$type<PageVersionId>()
      .notNull()
      .references(() => page_versions.id)
  },
  (t) => [primaryKey({ columns: [t.request_id, t.version_id] })]
);

export const note_context_sources = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'note_context_sources',
  {
    request_id: text()
      .notNull()
      .references(() => note_run_contexts.request_id, { onDelete: 'cascade' }),
    source_id: integer().$type<SourceId>().notNull(),
    revision: integer().$type<bigint>().notNull(),
    snapshot_id: integer().$type<ContentSnapshotId>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.request_id, t.source_id, t.revision, t.snapshot_id] }),
    foreignKey({
      columns: [t.source_id, t.revision, t.snapshot_id],
      foreignColumns: [
        source_extraction_revisions.source_id,
        source_extraction_revisions.revision,
        source_extraction_revisions.snapshot_id
      ]
    })
  ]
);

/** Content-free consumed intent identities prevent recapture after private content retirement. */
export const note_retired_intents = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'note_retired_intents',
  {
    note_id: integer().$type<NoteId>().notNull(),
    intent_key: text().notNull(),
    request_id: text().notNull().unique(),
    reason: text({ enum: ['note_deleted', 'input_retired'] }).notNull()
  },
  (t) => [primaryKey({ columns: [t.note_id, t.intent_key] })]
);
