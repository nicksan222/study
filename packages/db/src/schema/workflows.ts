import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Durable execution identity and the current owner's fencing token. */
export const workflow_executions = sqliteTable(
  'workflow_executions',
  {
    execution_id: text().primaryKey(),
    workflow_tag: text().notNull(),
    version: integer().notNull(),
    payload: text().notNull(),
    status: text({ enum: ['running', 'suspended', 'completed', 'cancelled'] }).notNull(),
    parent_execution_id: text(),
    result: text(),
    owner_token: text(),
    created_at: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    check('workflow_executions_version_check', sql`${t.version} > 0`),
    check('workflow_executions_payload_check', sql`json_valid(${t.payload})`),
    check('workflow_executions_result_check', sql`${t.result} IS NULL OR json_valid(${t.result})`),
    check(
      'workflow_executions_status_check',
      sql`${t.status} IN ('running', 'suspended', 'completed', 'cancelled')`
    ),
    index('workflow_executions_parent_idx').on(t.parent_execution_id),
    index('workflow_executions_recovery_idx').on(t.status, t.workflow_tag, t.updated_at),
    index('workflow_executions_pagination_idx').on(t.created_at, t.execution_id),
    index('workflow_executions_correlation_pagination_idx').on(
      sql`json_extract(${t.payload}, '$.event.correlationId')`,
      t.created_at,
      t.execution_id
    )
  ]
);

/** Completed activity results keyed by the native activity name and attempt. */
export const workflow_activities = sqliteTable(
  'workflow_activities',
  {
    execution_id: text()
      .notNull()
      .references(() => workflow_executions.execution_id, { onDelete: 'cascade' }),
    name: text().notNull(),
    attempt: integer().notNull(),
    result: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.execution_id, t.name, t.attempt] }),
    check('workflow_activities_attempt_check', sql`${t.attempt} >= 0`),
    check('workflow_activities_result_check', sql`json_valid(${t.result})`)
  ]
);

export const workflow_deferreds = sqliteTable(
  'workflow_deferreds',
  {
    execution_id: text()
      .notNull()
      .references(() => workflow_executions.execution_id, { onDelete: 'cascade' }),
    name: text().notNull(),
    result: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.execution_id, t.name] }),
    check('workflow_deferreds_result_check', sql`json_valid(${t.result})`)
  ]
);

export const workflow_clocks = sqliteTable(
  'workflow_clocks',
  {
    execution_id: text()
      .notNull()
      .references(() => workflow_executions.execution_id, { onDelete: 'cascade' }),
    name: text().notNull(),
    deferred_name: text().notNull(),
    due_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.execution_id, t.name] }),
    index('workflow_clocks_due_idx').on(t.due_at)
  ]
);
