import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { workflow_executions } from './workflows.ts';

/** Native deferred registrations retained while an execution awaits configuration. */
export const workflow_configuration_waits = sqliteTable(
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
