import { configurationWaitReasonSchema } from '@study/contracts/workflows/schemas';

import { check, defineTable, primaryKey, sql, text } from '../schema-builder.ts';
import { workflow_executions } from './workflows.ts';

/** Native deferred registrations retained while an execution awaits configuration. */
export const workflow_configuration_waits = defineTable({
  role: 'internal',
  reason: 'Durable execution and recovery state'
})(
  'workflow_configuration_waits',
  {
    execution_id: text()
      .notNull()
      .references(() => workflow_executions.execution_id, { onDelete: 'cascade' }),
    deferred_name: text().notNull(),
    observed_revision: text().notNull(),
    reason: text({ enum: configurationWaitReasonSchema.literals })
  },
  (t) => [
    primaryKey({ columns: [t.execution_id, t.deferred_name] }),
    check(
      'workflow_configuration_waits_reason_check',
      sql`${t.reason} IN ('auth', 'config', 'model_unavailable')`
    )
  ]
);
