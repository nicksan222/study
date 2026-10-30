import type { MaterialVersionId, ProjectId } from '@study/contracts/ids';
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

import { material_versions } from './material-versions.ts';
import { projects } from './sources.ts';

export const material_generation_requests = sqliteTable(
  'material_generation_requests',
  {
    id: text().primaryKey(),
    project_id: integer()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
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
      columns: [t.result_version_id, t.project_id],
      foreignColumns: [material_versions.id, material_versions.project_id]
    }).onDelete('no action')
  ]
);

export const material_generation_inputs = sqliteTable(
  'material_generation_inputs',
  {
    request_id: text().notNull(),
    project_id: integer().$type<ProjectId>().notNull(),
    version_id: integer().$type<MaterialVersionId>().notNull(),
    position: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.request_id, t.version_id] }),
    uniqueIndex('material_generation_inputs_position_unique').on(t.request_id, t.position),
    foreignKey({
      columns: [t.request_id, t.project_id],
      foreignColumns: [material_generation_requests.id, material_generation_requests.project_id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.version_id, t.project_id],
      foreignColumns: [material_versions.id, material_versions.project_id]
    }).onDelete('no action'),
    check('material_generation_inputs_position_check', sql`${t.position} >= 0`)
  ]
);
