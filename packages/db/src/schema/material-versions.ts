import type { MaterialId, MaterialVersionId, ProjectId, SessionId } from '@study/contracts/ids';
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
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { materialKinds, materialOperations } from '../material-kinds.ts';
import { sessions } from './conversations.ts';

/** Durable library content; collection and session membership never own it. */
export const materials = sqliteTable(
  'materials',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<MaterialId>(),
    kind: text({ enum: materialKinds }).notNull(),
    title: text().notNull(),
    created_at: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull(),
    archived_at: integer().$type<bigint>()
  },
  (t) => [
    uniqueIndex('materials_id_kind_unique').on(t.id, t.kind),
    check(
      'materials_kind_check',
      sql`kind IN ('file','audio','video','image','link','document','diagram','quiz','flashcards')`
    ),
    check('materials_title_check', sql`length(trim(title)) BETWEEN 1 AND 200`),
    check(
      'materials_times_check',
      sql`id > 0 AND typeof(created_at) = 'integer' AND typeof(updated_at) = 'integer' AND created_at >= 0 AND updated_at >= created_at AND (archived_at IS NULL OR (typeof(archived_at) = 'integer' AND archived_at >= created_at))`
    )
  ]
);

export const session_materials = sqliteTable(
  'session_materials',
  {
    session_id: integer().$type<SessionId>().notNull(),
    material_id: integer().$type<MaterialId>().notNull(),
    position: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.session_id, t.material_id] }),
    foreignKey({
      columns: [t.session_id],
      foreignColumns: [sessions.id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.material_id],
      foreignColumns: [materials.id]
    }).onDelete('cascade'),
    uniqueIndex('session_materials_position_unique').on(t.session_id, t.position),
    index('session_materials_material_idx').on(t.material_id, t.session_id),
    check('session_materials_position_check', sql`typeof(position) = 'integer' AND position >= 0`)
  ]
);

/** Draft payloads are assembled transactionally; published snapshots are sealed by SQLite. */
export const material_versions = sqliteTable(
  'material_versions',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<MaterialVersionId>(),
    material_id: integer().$type<MaterialId>().notNull(),
    kind: text({ enum: materialKinds }).notNull(),
    number: integer().$type<bigint>().notNull(),
    status: text({ enum: ['draft', 'published'] })
      .notNull()
      .default('draft'),
    operation: text({ enum: materialOperations }).notNull().default('original'),
    creator: text({ enum: ['user', 'agent', 'import'] })
      .notNull()
      .default('user'),
    instruction: text(),
    generation_request_id: text().references(
      (): AnySQLiteColumn => material_generation_requests.id
    ),
    language: text(),
    created_at: integer().$type<bigint>().notNull(),
    published_at: integer().$type<bigint>()
  },
  (t) => [
    foreignKey({
      columns: [t.material_id, t.kind],
      foreignColumns: [materials.id, materials.kind]
    }).onDelete('cascade'),
    uniqueIndex('material_versions_generation_request_unique').on(t.generation_request_id),
    uniqueIndex('material_versions_number_unique').on(t.material_id, t.number),
    uniqueIndex('material_versions_id_kind_unique').on(t.id, t.kind),
    uniqueIndex('material_versions_id_material_kind_unique').on(t.id, t.material_id, t.kind),
    uniqueIndex('material_versions_id_material_unique').on(t.id, t.material_id),
    index('material_versions_heads_idx').on(t.material_id, t.status, desc(t.number)),
    check(
      'material_versions_identity_check',
      sql`id > 0 AND typeof(number) = 'integer' AND number > 0`
    ),
    check(
      'material_versions_status_check',
      sql`status IN ('draft','published') AND ((status = 'published') = (published_at IS NOT NULL))`
    ),
    check(
      'material_versions_operation_check',
      sql`operation IN ('original','edit','summarize','translate','generate','extract','transcribe')`
    ),
    check('material_versions_creator_check', sql`creator IN ('user','agent','import')`),
    check(
      'material_versions_language_check',
      sql`language IS NULL OR length(trim(language)) BETWEEN 1 AND 64`
    ),
    check(
      'material_versions_instruction_check',
      sql`instruction IS NULL OR length(trim(instruction)) BETWEEN 1 AND 100000`
    ),
    check(
      'material_versions_times_check',
      sql`typeof(created_at) = 'integer' AND created_at >= 0 AND (published_at IS NULL OR (typeof(published_at) = 'integer' AND published_at >= created_at))`
    )
  ]
);

export const material_version_parents = sqliteTable(
  'material_version_parents',
  {
    version_id: integer().$type<MaterialVersionId>().notNull(),
    parent_version_id: integer().$type<MaterialVersionId>().notNull(),
    material_id: integer().$type<MaterialId>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.version_id, t.parent_version_id] }),
    foreignKey({
      columns: [t.version_id, t.material_id],
      foreignColumns: [material_versions.id, material_versions.material_id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.parent_version_id, t.material_id],
      foreignColumns: [material_versions.id, material_versions.material_id]
    }).onDelete('cascade'),
    index('material_version_parents_parent_idx').on(t.parent_version_id, t.version_id),
    index('material_version_parents_material_idx').on(t.material_id),
    check('material_version_parents_distinct_check', sql`version_id != parent_version_id`)
  ]
);

export const material_version_inputs = sqliteTable(
  'material_version_inputs',
  {
    version_id: integer().$type<MaterialVersionId>().notNull(),
    input_version_id: integer().$type<MaterialVersionId>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.version_id, t.input_version_id] }),
    foreignKey({
      columns: [t.version_id],
      foreignColumns: [material_versions.id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.input_version_id],
      foreignColumns: [material_versions.id]
    }).onDelete('cascade'),
    index('material_version_inputs_input_idx').on(t.input_version_id, t.version_id),
    check('material_version_inputs_distinct_check', sql`version_id != input_version_id`)
  ]
);

export const material_generation_requests = sqliteTable(
  'material_generation_requests',
  {
    id: text().primaryKey(),
    project_id: integer().$type<ProjectId>().notNull(),
    payload: text().notNull(),
    result_version_id: integer().$type<MaterialVersionId>(),
    result_hash: text(),
    created_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    uniqueIndex('material_generation_requests_id_project_unique').on(t.id, t.project_id),
    check('material_generation_payload_check', sql`json_valid(${t.payload})`),
    check(
      'material_generation_result_pair_check',
      sql`(${t.result_version_id} IS NULL) = (${t.result_hash} IS NULL)`
    ),
    foreignKey({
      columns: [t.result_version_id],
      foreignColumns: [material_versions.id]
    }).onDelete('no action')
  ]
);

export const material_generation_inputs = sqliteTable(
  'material_generation_inputs',
  {
    request_id: text().notNull(),
    version_id: integer().$type<MaterialVersionId>().notNull(),
    position: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.request_id, t.version_id] }),
    uniqueIndex('material_generation_inputs_position_unique').on(t.request_id, t.position),
    foreignKey({
      columns: [t.request_id],
      foreignColumns: [material_generation_requests.id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.version_id],
      foreignColumns: [material_versions.id]
    }).onDelete('no action'),
    check('material_generation_inputs_position_check', sql`${t.position} >= 0`)
  ]
);
