import { defineTable, primaryKey, text } from '../schema-builder.ts';
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
    observed_revision: text().notNull()
  },
  (t) => [primaryKey({ columns: [t.execution_id, t.deferred_name] })]
);
