/** Exact authored provenance; collection membership never supplies evidence. */
import type {
  PageId,
  PageVersionId,
  ContentSnapshotId,
  SourceId,
  VersionId,
  NoteId,
  PageAnnotationId
} from '@study/contracts/ids';

import { requiredIdReference } from '../columns.ts';
import {
  defineTable,
  sql,
  integer,
  text,
  primaryKey,
  foreignKey,
  uniqueIndex,
  check
} from '../schema-builder.ts';
import { validAnchor } from './anchor-validity.ts';
import { content_snapshots } from './content-snapshots.ts';
import { exactCitationColumns, exactCitationConstraints } from './exact-content-input.ts';
import { notes, message_versions } from './notes.ts';
import { pages, page_versions } from './pages.ts';
import { source_snapshots, source_extraction_revisions } from './source-processing.ts';
import { sources } from './sources.ts';

export const note_sources = defineTable({ role: 'contributes', entity: 'source' })(
  'note_sources',
  {
    note_id: integer()
      .$type<NoteId>()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    source_id: integer()
      .$type<SourceId>()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    archived_at: integer().$type<bigint>(),
    position: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.note_id, t.source_id] }),
    uniqueIndex('note_sources_position').on(t.note_id, t.position),
    check('note_sources_position_check', sql`${t.position}>=0`)
  ]
);

export const page_generation_requests = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'page_generation_requests',
  {
    id: text().primaryKey(),
    page_id: requiredIdReference<PageId>(() => pages.id),
    expected_version_id: integer().$type<PageVersionId>(),
    note_id: integer()
      .$type<NoteId>()
      .references(() => notes.id, { onDelete: 'set null' }),
    intent_hash: text().notNull(),
    result_version_id: integer()
      .$type<PageVersionId>()
      .references(() => page_versions.id),
    created_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.expected_version_id, t.page_id],
      foreignColumns: [page_versions.id, page_versions.page_id]
    }),
    check('page_generation_hash', sql`length(${t.intent_hash})=64`),
    check(
      'page_creation_result',
      sql`${t.expected_version_id} IS NOT NULL OR ${t.result_version_id} IS NOT NULL`
    )
  ]
);

/** Exactly one authored version, source revision or original message version. */
export const page_inputs = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'page_inputs',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    version_id: integer()
      .$type<PageVersionId>()
      .references(() => page_versions.id),
    request_id: text().references(() => page_generation_requests.id),
    position: integer().$type<bigint>().notNull(),
    page_version_id: integer()
      .$type<PageVersionId>()
      .references(() => page_versions.id),
    source_id: integer().$type<SourceId>(),
    source_revision: integer().$type<bigint>(),
    source_snapshot_id: integer()
      .$type<ContentSnapshotId>()
      .references(() => content_snapshots.id),
    message_version_id: integer()
      .$type<VersionId>()
      .references(() => message_versions.id, { onDelete: 'set null' }),
    exact_message_version_id: integer().$type<VersionId>()
  },
  (t) => [
    uniqueIndex('page_inputs_owner').on(t.id, t.version_id),
    uniqueIndex('page_inputs_version_position').on(t.version_id, t.position),
    uniqueIndex('page_inputs_request_position').on(t.request_id, t.position),
    foreignKey({
      columns: [t.source_id, t.source_revision],
      foreignColumns: [source_snapshots.source_id, source_snapshots.revision]
    }),
    foreignKey({
      columns: [t.source_id, t.source_revision, t.source_snapshot_id],
      foreignColumns: [
        source_extraction_revisions.source_id,
        source_extraction_revisions.revision,
        source_extraction_revisions.snapshot_id
      ]
    }),
    check(
      'page_inputs_exact_target',
      sql`(${t.version_id} IS NOT NULL) != (${t.request_id} IS NOT NULL) AND ${t.position}>=0 AND
 ((${t.page_version_id} IS NOT NULL)+(${t.source_id} IS NOT NULL)+(${t.exact_message_version_id} IS NOT NULL))=1 AND
 ((${t.source_id} IS NULL)=(${t.source_revision} IS NULL)) AND (${t.source_snapshot_id} IS NULL OR ${t.source_id} IS NOT NULL) AND (${t.source_revision} IS NULL OR ${t.source_revision}>0) AND (${t.message_version_id} IS NULL OR ${t.message_version_id}=${t.exact_message_version_id})`
    )
  ]
);

export const page_citations = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'page_citations',
  {
    version_id: integer().$type<PageVersionId>().notNull(),
    ...exactCitationColumns()
  },
  (t) => [
    ...exactCitationConstraints(t, page_inputs),
    check('page_citations_anchor', validAnchor(t.anchor)),
    check(
      'page_citations_value',
      sql`${t.marker} BETWEEN 1 AND 4294967295 AND length(trim(${t.quote}))>0 AND (${t.target} IS NULL OR json_valid(${t.target}))`
    )
  ]
);

export const page_annotations = defineTable({ role: 'contributes', entity: 'page' })(
  'page_annotations',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<PageAnnotationId>(),
    page_id: requiredIdReference<PageId>(() => pages.id),
    revision: integer().$type<bigint>().notNull()
  },
  (t) => [
    uniqueIndex('page_annotations_owner').on(t.id, t.page_id),
    check('page_annotations_revision', sql`${t.revision}>0`)
  ]
);

export const page_annotation_revisions = defineTable({
  role: 'contributes',
  entity: 'page'
})(
  'page_annotation_revisions',
  {
    annotation_id: integer().$type<PageAnnotationId>().notNull(),
    revision: integer().$type<bigint>().notNull(),
    page_id: integer().$type<PageId>().notNull(),
    version_id: integer().$type<PageVersionId>().notNull(),
    snapshot_id: requiredIdReference<ContentSnapshotId>(() => content_snapshots.id),
    payload: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.annotation_id, t.revision] }),
    foreignKey({
      columns: [t.annotation_id, t.page_id],
      foreignColumns: [page_annotations.id, page_annotations.page_id]
    }),
    foreignKey({
      columns: [t.version_id, t.page_id],
      foreignColumns: [page_versions.id, page_versions.page_id]
    }),
    check('page_annotation_payload', sql`json_valid(${t.payload}) AND ${t.revision}>0`)
  ]
);

export const page_proposals = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})('page_proposals', {
  request_id: text()
    .primaryKey()
    .references(() => page_generation_requests.id),
  base_version_id: requiredIdReference<PageVersionId>(() => page_versions.id),
  proposed_version_id: integer()
    .$type<PageVersionId>()
    .notNull()
    .unique()
    .references(() => page_versions.id)
});

export const page_proposal_receipts = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'page_proposal_receipts',
  {
    key: text().primaryKey(),
    request_id: text()
      .notNull()
      .references(() => page_proposals.request_id),
    operation: text({ enum: ['apply', 'keep'] }).notNull(),
    intent: text().notNull(),
    outcome: text({ enum: ['applied', 'kept', 'conflict'] }).notNull(),
    current_version_id: requiredIdReference<PageVersionId>(() => page_versions.id),
    result_version_id: integer()
      .$type<PageVersionId>()
      .references(() => page_versions.id)
  },
  (t) => [
    check(
      'page_proposal_receipt',
      sql`json_valid(${t.intent}) AND ((${t.outcome}='conflict' AND ${t.operation}='apply' AND ${t.result_version_id} IS NULL) OR (${t.outcome}='applied' AND ${t.operation}='apply' AND ${t.result_version_id} IS NOT NULL) OR (${t.outcome}='kept' AND ${t.operation}='keep' AND ${t.result_version_id} IS NOT NULL))`
    )
  ]
);
/** Explicit body retirement retains version identity and immutable edit outcomes. */

export const page_retirements = defineTable({ role: 'contributes', entity: 'page' })(
  'page_retirements',
  {
    version_id: integer()
      .$type<PageVersionId>()
      .primaryKey()
      .references(() => page_versions.id),
    reason: text({ enum: ['history', 'deletion'] }).notNull(),
    created_at: integer().$type<bigint>().notNull()
  }
);

export const page_deletions = defineTable({ role: 'contributes', entity: 'page' })(
  'page_deletions',
  {
    page_id: integer()
      .$type<PageId>()
      .primaryKey()
      .references(() => pages.id),
    created_at: integer().$type<bigint>().notNull()
  }
);
/** User judgments belong to one exact declared citation; never inferred verification. */

export const page_citation_assessments = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'page_citation_assessments',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    version_id: integer().$type<PageVersionId>().notNull(),
    marker: integer().$type<bigint>().notNull(),
    payload: text().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.version_id, t.marker],
      foreignColumns: [page_citations.version_id, page_citations.marker]
    }),
    check('page_assessment_payload', sql`json_valid(${t.payload})`)
  ]
);
