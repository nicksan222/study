import type { MaterialId, SourceId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, check, primaryKey } from 'drizzle-orm/sqlite-core';

import { cleanupAttemptColumns } from './column-types.ts';

/** Content-free barrier and exact cleanup attempt; independent of content lifetimes. */
export const material_deletions = sqliteTable(
  'material_deletions',
  {
    material_id: integer().$type<MaterialId>().primaryKey(),
    operation_id: text().notNull().unique(),
    selection: text().notNull(),
    status: text({ enum: ['pending', 'failed', 'completed'] }).notNull(),
    phase: text({ enum: ['accepted', 'retired', 'completed'] })
      .notNull()
      .default('accepted'),
    ...cleanupAttemptColumns()
  },
  (t) => [
    check(
      'material_deletion_state',
      sql`${t.attempt} >= 1 AND json_valid(${t.selection}) AND ${t.status} IN ('pending','failed','completed') AND ${t.phase} IN ('accepted','retired','completed') AND ((${t.status}='completed')=(${t.completed_at} IS NOT NULL)) AND ((${t.status}='failed')=(${t.error_kind} IS NOT NULL))`
    )
  ]
);

export const material_deletion_members = sqliteTable('material_deletion_members', {
  material_id: integer().$type<MaterialId>().primaryKey(),
  deletion_id: integer()
    .$type<MaterialId>()
    .notNull()
    .references(() => material_deletions.material_id)
});

/** Exact captured ownership survives scrub and restart without retaining captured content. */
export const material_deletion_requests = sqliteTable('material_deletion_requests', {
  request_id: text().primaryKey(),
  deletion_id: integer()
    .$type<MaterialId>()
    .notNull()
    .references(() => material_deletions.material_id),
  kind: text({
    enum: ['generation', 'context', 'source', 'learning', 'publication', 'recording']
  }).notNull()
});

/** Sources retains exact revisions before source-version and Document asset roots disappear. */
export const source_material_deletion_assets = sqliteTable(
  'source_material_deletion_assets',
  {
    deletion_id: integer()
      .$type<MaterialId>()
      .notNull()
      .references(() => material_deletions.material_id),
    source_id: integer().$type<SourceId>().notNull(),
    revision: integer().$type<bigint>().notNull()
  },
  (t) => [primaryKey({ columns: [t.deletion_id, t.source_id, t.revision] })]
);
