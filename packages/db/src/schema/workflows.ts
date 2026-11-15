import { defineTable, sql, check, index, integer, primaryKey, text } from '../schema-builder.ts';

/** Domain admission identity, publication generation, and authoritative outcome. */
export const workflow_executions = defineTable({
  role: 'internal',
  reason: 'Durable execution and recovery state'
})(
  'workflow_executions',
  {
    execution_id: text().primaryKey(),
    workflow_tag: text().notNull(),
    version: integer().notNull(),
    payload: text().notNull(),
    status: text({
      enum: ['running', 'suspended', 'cancelling', 'blocked', 'completed', 'cancelled']
    }).notNull(),
    generation: integer().notNull().default(1),
    cancellation_mode: text({ enum: ['safe', 'unsafe'] }),
    blocked_reason: text({ enum: ['unsupported'] }),
    parent_execution_id: text(),
    result: text(),
    created_at: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    check('workflow_executions_generation_check', sql`${t.generation} > 0`),
    check(
      'workflow_executions_cancellation_check',
      sql`${t.cancellation_mode} IS NULL OR ${t.cancellation_mode} IN ('safe', 'unsafe')`
    ),
    check('workflow_executions_version_check', sql`${t.version} > 0`),
    check('workflow_executions_payload_check', sql`json_valid(${t.payload})`),
    check('workflow_executions_result_check', sql`${t.result} IS NULL OR json_valid(${t.result})`),
    check(
      'workflow_executions_status_check',
      sql`${t.status} IN ('running', 'suspended', 'cancelling', 'blocked', 'completed', 'cancelled')`
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

/** Content-free fences survive payload scrubbing and duplicate event delivery. */
export const workflow_retired_correlations = defineTable({
  role: 'internal',
  reason: 'Durable execution and recovery state'
})(
  'workflow_retired_correlations',
  {
    correlation_id: text().notNull(),
    event_type: text().notNull()
  },
  (t) => [primaryKey({ columns: [t.correlation_id, t.event_type] })]
);

export const workflow_retired_executions = defineTable({
  role: 'internal',
  reason: 'Durable execution and recovery state'
})('workflow_retired_executions', {
  execution_id: text().primaryKey(),
  correlation_id: text().notNull()
});
