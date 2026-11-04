import type {
  StudyDocumentId,
  StudyDocumentVersionId,
  ContentSnapshotId,
  SessionId,
  ProjectId
} from '@study/contracts/ids';
import { sql, desc } from 'drizzle-orm';
import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  foreignKey,
  uniqueIndex,
  index,
  check
} from 'drizzle-orm/sqlite-core';

import { libraryContentColumns } from './column-types.ts';
import { content_snapshots } from './content-snapshots.ts';
import { sessions } from './conversations.ts';
import { projects } from './sources.ts';

/** Authored output identity, independent of sources, sessions and learning materials. */
export const study_documents = sqliteTable(
  'study_documents',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<StudyDocumentId>(),
    ...libraryContentColumns()
  },
  (t) => [
    uniqueIndex('study_documents_create_key_unique').on(t.create_key),
    check('study_documents_title_check', sql`length(trim(${t.title})) BETWEEN 1 AND 200`),
    check(
      'study_documents_description_check',
      sql`${t.description} IS NULL OR length(${t.description}) <= 240`
    ),
    check(
      'study_documents_creation_check',
      sql`(${t.create_key} IS NULL AND ${t.creation_intent} IS NULL) OR (length(${t.create_key}) BETWEEN 1 AND 200 AND json_valid(${t.creation_intent}))`
    ),
    check(
      'study_documents_times_check',
      sql`${t.id} > 0 AND typeof(${t.created_at}) = 'integer' AND ${t.created_at} >= 0 AND typeof(${t.updated_at}) = 'integer' AND ${t.updated_at} >= ${t.created_at} AND (${t.archived_at} IS NULL OR (typeof(${t.archived_at}) = 'integer' AND ${t.archived_at} >= ${t.created_at}))`
    )
  ]
);

/** A version owns exactly one canonical snapshot; publication seals both together. */
export const study_document_versions = sqliteTable(
  'study_document_versions',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<StudyDocumentVersionId>(),
    document_id: integer()
      .$type<StudyDocumentId>()
      .notNull()
      .references(() => study_documents.id),
    number: integer().$type<bigint>().notNull(),
    status: text({ enum: ['draft', 'published'] })
      .notNull()
      .default('draft'),
    operation: text({ enum: ['original', 'edit', 'summarize', 'translate', 'generate', 'restore'] })
      .notNull()
      .default('original'),
    creator: text({ enum: ['user', 'agent'] })
      .notNull()
      .default('user'),
    content_snapshot_id: integer()
      .$type<ContentSnapshotId>()
      .notNull()
      .references(() => content_snapshots.id),
    instruction: text(),
    language: text(),
    created_at: integer().$type<bigint>().notNull(),
    published_at: integer().$type<bigint>()
  },
  (t) => [
    uniqueIndex('study_document_versions_number_unique').on(t.document_id, t.number),
    uniqueIndex('study_document_versions_owner_unique').on(t.id, t.document_id),
    uniqueIndex('study_document_versions_content_unique').on(t.content_snapshot_id),
    index('study_document_versions_heads_idx').on(t.document_id, t.status, desc(t.number)),
    check(
      'study_document_versions_identity_check',
      sql`${t.id} > 0 AND typeof(${t.number}) = 'integer' AND ${t.number} > 0`
    ),
    check(
      'study_document_versions_status_check',
      sql`${t.status} IN ('draft','published') AND ((${t.status} = 'published') = (${t.published_at} IS NOT NULL))`
    ),
    check(
      'study_document_versions_operation_check',
      sql`${t.operation} IN ('original','edit','summarize','translate','generate','restore')`
    ),
    check('study_document_versions_creator_check', sql`${t.creator} IN ('user','agent')`),
    check(
      'study_document_versions_language_check',
      sql`${t.language} IS NULL OR length(trim(${t.language})) BETWEEN 1 AND 64`
    ),
    check(
      'study_document_versions_instruction_check',
      sql`${t.instruction} IS NULL OR length(trim(${t.instruction})) BETWEEN 1 AND 100000`
    ),
    check(
      'study_document_versions_times_check',
      sql`typeof(${t.created_at}) = 'integer' AND ${t.created_at} >= 0 AND (${t.published_at} IS NULL OR (typeof(${t.published_at}) = 'integer' AND ${t.published_at} >= ${t.created_at}))`
    )
  ]
);

export const study_document_version_parents = sqliteTable(
  'study_document_version_parents',
  {
    version_id: integer().$type<StudyDocumentVersionId>().notNull(),
    parent_version_id: integer().$type<StudyDocumentVersionId>().notNull(),
    document_id: integer().$type<StudyDocumentId>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.version_id, t.parent_version_id] }),
    foreignKey({
      columns: [t.version_id, t.document_id],
      foreignColumns: [study_document_versions.id, study_document_versions.document_id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.parent_version_id, t.document_id],
      foreignColumns: [study_document_versions.id, study_document_versions.document_id]
    }),
    index('study_document_version_parents_parent_idx').on(t.parent_version_id, t.version_id),
    check(
      'study_document_version_parents_distinct_check',
      sql`${t.version_id} != ${t.parent_version_id}`
    )
  ]
);

/** Organizational links do not own output lifetime or provide generation provenance. */
export const project_documents = sqliteTable(
  'project_documents',
  {
    project_id: integer()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    document_id: integer()
      .$type<StudyDocumentId>()
      .notNull()
      .references(() => study_documents.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.project_id, t.document_id] }),
    index('project_documents_document_idx').on(t.document_id)
  ]
);

export const session_documents = sqliteTable(
  'session_documents',
  {
    session_id: integer()
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    document_id: integer()
      .$type<StudyDocumentId>()
      .notNull()
      .references(() => study_documents.id, { onDelete: 'cascade' }),
    archived_at: integer().$type<bigint>(),
    position: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.session_id, t.document_id] }),
    uniqueIndex('session_documents_position_unique').on(t.session_id, t.position),
    index('session_documents_document_idx').on(t.document_id),
    check(
      'session_documents_position_check',
      sql`typeof(${t.position}) = 'integer' AND ${t.position} >= 0`
    )
  ]
);

/** Exact conflict alternatives and idempotent intent belong to one authored document. */
export const study_document_edit_receipts = sqliteTable(
  'study_document_edit_receipts',
  {
    document_id: integer()
      .$type<StudyDocumentId>()
      .notNull()
      .references(() => study_documents.id),
    key: text().notNull(),
    operation: text({ enum: ['save', 'restore'] }).notNull(),
    intent: text().notNull(),
    expected_version_id: integer().$type<StudyDocumentVersionId>().notNull(),
    current_version_id: integer().$type<StudyDocumentVersionId>().notNull(),
    submitted_version_id: integer().$type<StudyDocumentVersionId>().notNull(),
    outcome: text({ enum: ['saved', 'conflict'] }).notNull()
  },
  (t) => [
    primaryKey({ columns: [t.document_id, t.key] }),
    uniqueIndex('study_document_edit_receipts_submitted_unique').on(t.submitted_version_id),
    ...[t.expected_version_id, t.current_version_id, t.submitted_version_id].map((version) =>
      foreignKey({
        columns: [version, t.document_id],
        foreignColumns: [study_document_versions.id, study_document_versions.document_id]
      })
    ),
    check(
      'study_document_edit_receipts_intent_check',
      sql`json_valid(${t.intent}) AND length(${t.key}) BETWEEN 1 AND 200`
    ),
    check(
      'study_document_edit_receipts_outcome_check',
      sql`${t.operation} IN ('save','restore') AND ${t.outcome} IN ('saved','conflict') AND (${t.outcome} != 'saved' OR ${t.expected_version_id} = ${t.current_version_id})`
    )
  ]
);
