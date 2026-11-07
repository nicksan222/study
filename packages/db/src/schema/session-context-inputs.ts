import type {
  StudyDocumentVersionId,
  SourceId,
  ContentSnapshotId,
  SessionId
} from '@study/contracts/ids';

import { defineTable, text, integer, primaryKey, foreignKey } from '../schema-builder.ts';
import { session_run_contexts } from './conversations.ts';
import { source_extraction_revisions } from './source-processing.ts';
import { study_document_versions } from './study-documents.ts';

/** Exact captures pin inputs until the owning private capture is explicitly retired. */
export const session_context_documents = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'session_context_documents',
  {
    request_id: text()
      .notNull()
      .references(() => session_run_contexts.request_id, { onDelete: 'cascade' }),
    version_id: integer()
      .$type<StudyDocumentVersionId>()
      .notNull()
      .references(() => study_document_versions.id)
  },
  (t) => [primaryKey({ columns: [t.request_id, t.version_id] })]
);

export const session_context_sources = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'session_context_sources',
  {
    request_id: text()
      .notNull()
      .references(() => session_run_contexts.request_id, { onDelete: 'cascade' }),
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
export const session_retired_intents = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'session_retired_intents',
  {
    session_id: integer().$type<SessionId>().notNull(),
    intent_key: text().notNull(),
    request_id: text().notNull().unique(),
    reason: text({ enum: ['session_deleted', 'input_retired'] }).notNull()
  },
  (t) => [primaryKey({ columns: [t.session_id, t.intent_key] })]
);
