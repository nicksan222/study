import type { MaterialId, MaterialVersionId, ProjectId } from '@study/contracts/ids';

import { materialKinds, materialOperations } from '../material-kinds.ts';
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
import type { AnySQLiteColumn } from '../schema-builder.ts';
import { libraryContentColumns } from './column-types.ts';

/** Durable library content; collection and note membership never own it. */
export const materials = defineTable({
  role: 'entity',
  projection: 'feature',
  kind: 'material',
  description: 'Published learning materials and their content',
  textColumns: ['title', 'description']
})(
  'materials',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<MaterialId>(),
    kind: text({ enum: materialKinds }).notNull(),
    ...libraryContentColumns()
  },
  (t) => [
    uniqueIndex('materials_id_kind_unique').on(t.id, t.kind),
    uniqueIndex('materials_create_key_unique').on(t.create_key),
    check(
      'materials_description_check',
      sql`${t.description} IS NULL OR length(${t.description}) <= 240`
    ),
    check(
      'materials_creation_intent_check',
      sql`(${t.create_key} IS NULL AND ${t.creation_intent} IS NULL) OR (length(${t.create_key}) BETWEEN 1 AND 200 AND json_valid(${t.creation_intent}))`
    ),
    check('materials_kind_check', sql`kind IN ('quiz','flashcards')`),
    check('materials_title_check', sql`length(trim(title)) BETWEEN 1 AND 200`),
    check(
      'materials_times_check',
      sql`id > 0 AND typeof(created_at) = 'integer' AND typeof(updated_at) = 'integer' AND created_at >= 0 AND updated_at >= created_at AND (archived_at IS NULL OR (typeof(archived_at) = 'integer' AND archived_at >= created_at))`
    )
  ]
);

/** Draft payloads are assembled transactionally; published snapshots are sealed by SQLite. */
export const material_versions = defineTable({ role: 'contributes', entity: 'material' })(
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
    creator: text({ enum: ['user', 'agent'] })
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
    check('material_versions_operation_check', sql`operation IN ('original','edit','generate')`),
    check('material_versions_creator_check', sql`creator IN ('user','agent')`),
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

export const material_version_parents = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
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

export const material_generation_requests = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'material_generation_requests',
  {
    id: text().primaryKey(),
    project_id: integer().$type<ProjectId>(),
    cancelled: integer({ mode: 'boolean' }).notNull().default(false),
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
