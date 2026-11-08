import type {
  PageId,
  PageVersionId,
  ContentSnapshotId,
  NoteId,
  ProjectId
} from '@study/contracts/ids';

import {
  defineTable,
  sql,
  desc,
  integer,
  text,
  primaryKey,
  foreignKey,
  uniqueIndex,
  index,
  check
} from '../schema-builder.ts';
import { libraryContentColumns } from './column-types.ts';
import { content_snapshots } from './content-snapshots.ts';
import { notes } from './notes.ts';
import { projects } from './sources.ts';

/** Authored output identity, independent of sources, notes and learning materials. */
export const pages = defineTable({
  role: 'entity',
  projection: 'feature',
  kind: 'page',
  description: 'Published authored pages and their blocks',
  textColumns: ['title', 'description']
})(
  'pages',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<PageId>(),
    ...libraryContentColumns()
  },
  (t) => [
    uniqueIndex('pages_create_key_unique').on(t.create_key),
    check('pages_title_check', sql`length(trim(${t.title})) BETWEEN 1 AND 200`),
    check(
      'pages_description_check',
      sql`${t.description} IS NULL OR length(${t.description}) <= 240`
    ),
    check(
      'pages_creation_check',
      sql`(${t.create_key} IS NULL AND ${t.creation_intent} IS NULL) OR (length(${t.create_key}) BETWEEN 1 AND 200 AND json_valid(${t.creation_intent}))`
    ),
    check(
      'pages_times_check',
      sql`${t.id} > 0 AND typeof(${t.created_at}) = 'integer' AND ${t.created_at} >= 0 AND typeof(${t.updated_at}) = 'integer' AND ${t.updated_at} >= ${t.created_at} AND (${t.archived_at} IS NULL OR (typeof(${t.archived_at}) = 'integer' AND ${t.archived_at} >= ${t.created_at}))`
    )
  ]
);

/** A version owns exactly one canonical snapshot; publication seals both together. */
export const page_versions = defineTable({ role: 'contributes', entity: 'page' })(
  'page_versions',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<PageVersionId>(),
    page_id: integer()
      .$type<PageId>()
      .notNull()
      .references(() => pages.id),
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
    uniqueIndex('page_versions_number_unique').on(t.page_id, t.number),
    uniqueIndex('page_versions_owner_unique').on(t.id, t.page_id),
    uniqueIndex('page_versions_content_unique').on(t.content_snapshot_id),
    index('page_versions_heads_idx').on(t.page_id, t.status, desc(t.number)),
    check(
      'page_versions_identity_check',
      sql`${t.id} > 0 AND typeof(${t.number}) = 'integer' AND ${t.number} > 0`
    ),
    check(
      'page_versions_status_check',
      sql`${t.status} IN ('draft','published') AND ((${t.status} = 'published') = (${t.published_at} IS NOT NULL))`
    ),
    check(
      'page_versions_operation_check',
      sql`${t.operation} IN ('original','edit','summarize','translate','generate','restore')`
    ),
    check('page_versions_creator_check', sql`${t.creator} IN ('user','agent')`),
    check(
      'page_versions_language_check',
      sql`${t.language} IS NULL OR length(trim(${t.language})) BETWEEN 1 AND 64`
    ),
    check(
      'page_versions_instruction_check',
      sql`${t.instruction} IS NULL OR length(trim(${t.instruction})) BETWEEN 1 AND 100000`
    ),
    check(
      'page_versions_times_check',
      sql`typeof(${t.created_at}) = 'integer' AND ${t.created_at} >= 0 AND (${t.published_at} IS NULL OR (typeof(${t.published_at}) = 'integer' AND ${t.published_at} >= ${t.created_at}))`
    )
  ]
);

export const page_version_parents = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'page_version_parents',
  {
    version_id: integer().$type<PageVersionId>().notNull(),
    parent_version_id: integer().$type<PageVersionId>().notNull(),
    page_id: integer().$type<PageId>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.version_id, t.parent_version_id] }),
    foreignKey({
      columns: [t.version_id, t.page_id],
      foreignColumns: [page_versions.id, page_versions.page_id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.parent_version_id, t.page_id],
      foreignColumns: [page_versions.id, page_versions.page_id]
    }),
    index('page_version_parents_parent_idx').on(t.parent_version_id, t.version_id),
    check('page_version_parents_distinct_check', sql`${t.version_id} != ${t.parent_version_id}`)
  ]
);

/** Organizational links do not own output lifetime or provide generation provenance. */
export const project_pages = defineTable({ role: 'contributes', entity: 'page' })(
  'project_pages',
  {
    project_id: integer()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    page_id: integer()
      .$type<PageId>()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.project_id, t.page_id] }),
    index('project_pages_page_idx').on(t.page_id)
  ]
);

export const note_pages = defineTable({ role: 'contributes', entity: 'page' })(
  'note_pages',
  {
    note_id: integer()
      .$type<NoteId>()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    page_id: integer()
      .$type<PageId>()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    archived_at: integer().$type<bigint>(),
    position: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.note_id, t.page_id] }),
    uniqueIndex('note_pages_position_unique').on(t.note_id, t.position),
    index('note_pages_page_idx').on(t.page_id),
    check(
      'note_pages_position_check',
      sql`typeof(${t.position}) = 'integer' AND ${t.position} >= 0`
    )
  ]
);

/** Exact conflict alternatives and idempotent intent belong to one authored document. */
export const page_edit_receipts = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'page_edit_receipts',
  {
    page_id: integer()
      .$type<PageId>()
      .notNull()
      .references(() => pages.id),
    key: text().notNull(),
    operation: text({ enum: ['save', 'restore'] }).notNull(),
    intent: text().notNull(),
    expected_version_id: integer().$type<PageVersionId>().notNull(),
    current_version_id: integer().$type<PageVersionId>().notNull(),
    submitted_version_id: integer().$type<PageVersionId>().notNull(),
    outcome: text({ enum: ['saved', 'conflict'] }).notNull()
  },
  (t) => [
    primaryKey({ columns: [t.page_id, t.key] }),
    uniqueIndex('page_edit_receipts_submitted_unique').on(t.submitted_version_id),
    ...[t.expected_version_id, t.current_version_id, t.submitted_version_id].map((version) =>
      foreignKey({
        columns: [version, t.page_id],
        foreignColumns: [page_versions.id, page_versions.page_id]
      })
    ),
    check(
      'page_edit_receipts_intent_check',
      sql`json_valid(${t.intent}) AND length(${t.key}) BETWEEN 1 AND 200`
    ),
    check(
      'page_edit_receipts_outcome_check',
      sql`${t.operation} IN ('save','restore') AND ${t.outcome} IN ('saved','conflict') AND (${t.outcome} != 'saved' OR ${t.expected_version_id} = ${t.current_version_id})`
    )
  ]
);
