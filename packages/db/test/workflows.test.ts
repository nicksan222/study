import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

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

    if (table !== workflow_executions) assert.equal(config.foreignKeys.length, 1);
  }
});
