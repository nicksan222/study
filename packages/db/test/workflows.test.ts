import { testStable } from '@study/testing/vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { assert } from 'vite-plus/test';

import {
  workflow_executions,
  workflow_activities,
  workflow_deferreds,
  workflow_clocks
} from '../src/schema/workflows.ts';

testStable('workflow journals define durable identities and foreign keys', () => {
  for (const table of [
    workflow_executions,
    workflow_activities,
    workflow_deferreds,
    workflow_clocks
  ]) {
    const config = getTableConfig(table);

    assert.ok(config.primaryKeys.length || config.columns.some((column) => column.primary));

    if (table !== workflow_executions) assert.strictEqual(config.foreignKeys.length, 1);
  }
});
