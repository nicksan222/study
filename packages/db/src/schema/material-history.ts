import type { MaterialId, MaterialVersionId, SessionId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, check, primaryKey } from 'drizzle-orm/sqlite-core';

import { materials, material_versions } from './material-versions.ts';

/** Durable explicit intent; stores identities and policy only, never a payload audit copy. */
export const material_history_prunes = sqliteTable(
  'material_history_prunes',
  {
    operation_id: text().primaryKey(),
    material_id: integer()
      .$type<MaterialId>()
      .notNull()
      .references(() => materials.id),
    keep_latest: integer().notNull(),
    token: text().notNull(),
    selection: text().notNull(),
    status: text({ enum: ['pending', 'failed', 'completed'] }).notNull(),
    attempt: integer().notNull().default(1),
    error_kind: text(),
    created_at: integer().$type<bigint>().notNull(),
    completed_at: integer().$type<bigint>()
  },
  (t) => [
    check(
      'material_history_prune_state',
      sql`
  ${t.keep_latest} BETWEEN 1 AND 1000 AND ${t.attempt} >= 1 AND
  length(${t.operation_id}) BETWEEN 1 AND 200 AND length(${t.token})=64 AND
  json_valid(${t.selection}) AND json_array_length(${t.selection}) <= 100 AND
  ${t.status} IN ('pending','failed','completed') AND
  ((${t.status}='completed')=(${t.completed_at} IS NOT NULL)) AND
  ((${t.status}='failed')=(${t.error_kind} IS NOT NULL))
`
    )
  ]
);

/** Permanent exact-version barrier; the original immutable identity remains in version history. */
export const material_history_members = sqliteTable('material_history_members', {
  version_id: integer()
    .$type<MaterialVersionId>()
    .primaryKey()
    .references(() => material_versions.id),
  operation_id: text()
    .notNull()
    .references(() => material_history_prunes.operation_id)
});

/** Exact captured request ownership is independent of whole-Material deletion membership. */
export const material_history_requests = sqliteTable('material_history_requests', {
  request_id: text().primaryKey(),
  operation_id: text()
    .notNull()
    .references(() => material_history_prunes.operation_id),
  kind: text({ enum: ['generation', 'context', 'learning', 'publication', 'source'] }).notNull()
});

/** Consumed intent identity outlives private context cleanup without retaining its instruction. */
export const conversation_history_intents = sqliteTable(
  'conversation_history_intents',
  {
    session_id: integer().$type<SessionId>().notNull(),
    intent_key: text().notNull(),
    request_id: text()
      .notNull()
      .unique()
      .references(() => material_history_requests.request_id)
  },
  (t) => [primaryKey({ columns: [t.session_id, t.intent_key] })]
);
