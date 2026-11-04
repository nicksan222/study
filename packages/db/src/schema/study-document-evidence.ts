/** Exact authored provenance; collection membership never supplies evidence. */
import type {
  StudyDocumentId,
  StudyDocumentVersionId,
  ContentSnapshotId,
  SourceId,
  VersionId,
  SessionId,
  StudyDocumentAnnotationId
} from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  foreignKey,
  uniqueIndex,
  check
} from 'drizzle-orm/sqlite-core';

import { requiredIdReference } from '../columns.ts';
import { validAnchor } from './anchor-validity.ts';
import { content_snapshots } from './content-snapshots.ts';
import { sessions, message_versions } from './conversations.ts';
import { exactCitationColumns, exactCitationConstraints } from './exact-content-input.ts';
import { source_snapshots, source_extraction_revisions } from './source-processing.ts';
import { sources } from './sources.ts';
import { study_documents, study_document_versions } from './study-documents.ts';

export const session_sources = sqliteTable(
  'session_sources',
  {
    session_id: integer()
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    source_id: integer()
      .$type<SourceId>()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    position: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.session_id, t.source_id] }),
    uniqueIndex('session_sources_position').on(t.session_id, t.position),
    check('session_sources_position_check', sql`${t.position}>=0`)
  ]
);

export const study_document_generation_requests = sqliteTable(
  'study_document_generation_requests',
  {
    id: text().primaryKey(),
    document_id: requiredIdReference<StudyDocumentId>(() => study_documents.id),
    expected_version_id: integer().$type<StudyDocumentVersionId>(),
    session_id: integer()
      .$type<SessionId>()
      .references(() => sessions.id, { onDelete: 'set null' }),
    intent_hash: text().notNull(),
    result_version_id: integer()
      .$type<StudyDocumentVersionId>()
      .references(() => study_document_versions.id),
    created_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.expected_version_id, t.document_id],
      foreignColumns: [study_document_versions.id, study_document_versions.document_id]
    }),
    check('study_document_generation_hash', sql`length(${t.intent_hash})=64`),
    check(
      'study_document_creation_result',
      sql`${t.expected_version_id} IS NOT NULL OR ${t.result_version_id} IS NOT NULL`
    )
  ]
);

/** Exactly one authored version, source revision or original message version. */
export const study_document_inputs = sqliteTable(
  'study_document_inputs',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    version_id: integer()
      .$type<StudyDocumentVersionId>()
      .references(() => study_document_versions.id),
    request_id: text().references(() => study_document_generation_requests.id),
    position: integer().$type<bigint>().notNull(),
    document_version_id: integer()
      .$type<StudyDocumentVersionId>()
      .references(() => study_document_versions.id),
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
    uniqueIndex('study_document_inputs_owner').on(t.id, t.version_id),
    uniqueIndex('study_document_inputs_version_position').on(t.version_id, t.position),
    uniqueIndex('study_document_inputs_request_position').on(t.request_id, t.position),
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
      'study_document_inputs_exact_target',
      sql`(${t.version_id} IS NOT NULL) != (${t.request_id} IS NOT NULL) AND ${t.position}>=0 AND
 ((${t.document_version_id} IS NOT NULL)+(${t.source_id} IS NOT NULL)+(${t.exact_message_version_id} IS NOT NULL))=1 AND
 ((${t.source_id} IS NULL)=(${t.source_revision} IS NULL)) AND (${t.source_snapshot_id} IS NULL OR ${t.source_id} IS NOT NULL) AND (${t.source_revision} IS NULL OR ${t.source_revision}>0) AND (${t.message_version_id} IS NULL OR ${t.message_version_id}=${t.exact_message_version_id})`
    )
  ]
);

export const study_document_citations = sqliteTable(
  'study_document_citations',
  {
    version_id: integer().$type<StudyDocumentVersionId>().notNull(),
    ...exactCitationColumns()
  },
  (t) => [
    ...exactCitationConstraints(t, study_document_inputs),
    check('study_document_citations_anchor', validAnchor(t.anchor)),
    check(
      'study_document_citations_value',
      sql`${t.marker} BETWEEN 1 AND 4294967295 AND length(trim(${t.quote}))>0 AND (${t.target} IS NULL OR json_valid(${t.target}))`
    )
  ]
);

export const study_document_annotations = sqliteTable(
  'study_document_annotations',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<StudyDocumentAnnotationId>(),
    document_id: requiredIdReference<StudyDocumentId>(() => study_documents.id),
    revision: integer().$type<bigint>().notNull()
  },
  (t) => [
    uniqueIndex('study_document_annotations_owner').on(t.id, t.document_id),
    check('study_document_annotations_revision', sql`${t.revision}>0`)
  ]
);

export const study_document_annotation_revisions = sqliteTable(
  'study_document_annotation_revisions',
  {
    annotation_id: integer().$type<StudyDocumentAnnotationId>().notNull(),
    revision: integer().$type<bigint>().notNull(),
    document_id: integer().$type<StudyDocumentId>().notNull(),
    version_id: integer().$type<StudyDocumentVersionId>().notNull(),
    snapshot_id: requiredIdReference<ContentSnapshotId>(() => content_snapshots.id),
    payload: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.annotation_id, t.revision] }),
    foreignKey({
      columns: [t.annotation_id, t.document_id],
      foreignColumns: [study_document_annotations.id, study_document_annotations.document_id]
    }),
    foreignKey({
      columns: [t.version_id, t.document_id],
      foreignColumns: [study_document_versions.id, study_document_versions.document_id]
    }),
    check('study_document_annotation_payload', sql`json_valid(${t.payload}) AND ${t.revision}>0`)
  ]
);

export const study_document_proposals = sqliteTable('study_document_proposals', {
  request_id: text()
    .primaryKey()
    .references(() => study_document_generation_requests.id),
  base_version_id: requiredIdReference<StudyDocumentVersionId>(() => study_document_versions.id),
  proposed_version_id: integer()
    .$type<StudyDocumentVersionId>()
    .notNull()
    .unique()
    .references(() => study_document_versions.id)
});

export const study_document_proposal_receipts = sqliteTable(
  'study_document_proposal_receipts',
  {
    key: text().primaryKey(),
    request_id: text()
      .notNull()
      .references(() => study_document_proposals.request_id),
    operation: text({ enum: ['apply', 'keep'] }).notNull(),
    intent: text().notNull(),
    outcome: text({ enum: ['applied', 'kept', 'conflict'] }).notNull(),
    current_version_id: requiredIdReference<StudyDocumentVersionId>(
      () => study_document_versions.id
    ),
    result_version_id: integer()
      .$type<StudyDocumentVersionId>()
      .references(() => study_document_versions.id)
  },
  (t) => [
    check(
      'study_document_proposal_receipt',
      sql`json_valid(${t.intent}) AND ((${t.outcome}='conflict' AND ${t.operation}='apply' AND ${t.result_version_id} IS NULL) OR (${t.outcome}='applied' AND ${t.operation}='apply' AND ${t.result_version_id} IS NOT NULL) OR (${t.outcome}='kept' AND ${t.operation}='keep' AND ${t.result_version_id} IS NOT NULL))`
    )
  ]
);
/** Explicit body retirement retains version identity and immutable edit outcomes. */

export const study_document_retirements = sqliteTable('study_document_retirements', {
  version_id: integer()
    .$type<StudyDocumentVersionId>()
    .primaryKey()
    .references(() => study_document_versions.id),
  reason: text({ enum: ['history', 'deletion'] }).notNull(),
  created_at: integer().$type<bigint>().notNull()
});

export const study_document_deletions = sqliteTable('study_document_deletions', {
  document_id: integer()
    .$type<StudyDocumentId>()
    .primaryKey()
    .references(() => study_documents.id),
  created_at: integer().$type<bigint>().notNull()
});
/** User judgments belong to one exact declared citation; never inferred verification. */

export const study_document_citation_assessments = sqliteTable(
  'study_document_citation_assessments',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    version_id: integer().$type<StudyDocumentVersionId>().notNull(),
    marker: integer().$type<bigint>().notNull(),
    payload: text().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.version_id, t.marker],
      foreignColumns: [study_document_citations.version_id, study_document_citations.marker]
    }),
    check('study_document_assessment_payload', sql`json_valid(${t.payload})`)
  ]
);
