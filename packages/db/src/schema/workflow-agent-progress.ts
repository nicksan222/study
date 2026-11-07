import { sql, check, index, integer, defineTable, text } from '../schema-builder.ts';
import { workflow_executions } from './workflows.ts';

/** Reconnectable generation previews, fenced by the owning workflow activity lease. */
export const workflow_agent_progress = defineTable({
  role: 'internal',
  reason: 'Durable agent progress is scoped to workflow executions.'
})(
  'workflow_agent_progress',
  {
    run_id: text().primaryKey(),
    execution_id: text()
      .notNull()
      .references(() => workflow_executions.execution_id, { onDelete: 'cascade' }),
    owner_token: text().notNull(),
    activity_name: text().notNull(),
    attempt: integer().notNull(),
    agent_id: text().notNull(),
    mode: text({ enum: ['text', 'object'] }).notNull(),
    status: text({ enum: ['running', 'completed', 'failed', 'cancelled'] }).notNull(),
    failure_kind: text(),
    text: text().notNull().default(''),
    tools: text().notNull().default('[]'),
    revision: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    check('workflow_agent_progress_tools_check', sql`json_valid(${t.tools})`),
    check('workflow_agent_progress_mode_check', sql`${t.mode} IN ('text', 'object')`),
    check(
      'workflow_agent_progress_status_check',
      sql`${t.status} IN ('running', 'completed', 'failed', 'cancelled')`
    ),
    index('workflow_agent_progress_execution_idx').on(t.execution_id, t.updated_at)
  ]
);
