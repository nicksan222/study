import type { ProjectId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { sqliteBoolean } from './column-types.ts';
import { projects } from './sources.ts';

export const material_generation_scopes = sqliteTable(
  'material_generation_scopes',
  {
    id: text().primaryKey(),
    project_id: integer()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    enabled: sqliteBoolean().notNull(),
    created_at: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    check(
      'material_generation_scope_values',
      sql`length(${t.id}) > 0 AND ${t.enabled} IN (0, 1) AND ${t.created_at} >= 0 AND ${t.updated_at} >= ${t.created_at}`
    )
  ]
);
