import { defineRule } from 'vite-plus/lint/plugins';

import { persistenceWriters } from './persistence-writers.ts';
import { production } from './synchronous-transactions.ts';

const owners: Record<string, string[]> = {
  workflow_executions: ['store', 'triggers'],
  workflow_activities: ['store'],
  workflow_deferreds: ['store'],
  workflow_clocks: ['store'],
  workflow_events: ['events'],
  workflow_receipts: ['triggers'],
  workflow_configuration_waits: ['retry', 'configuration']
};

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    const path = context.filename.replaceAll('\\', '/');
    const allowed = (table: string) =>
      owners[table]?.some((owner) =>
        path.endsWith(`/apps/server/src/platform/workflows/${owner}.ts`)
      );
    const report = (node: any, table: string) => {
      if (owners[table] && !allowed(table))
        context.report({ node, message: `Only the canonical workflow owner may write ${table}.` });
    };

    return persistenceWriters(context, report);
  }
});
