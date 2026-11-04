import { testStable } from '@study/testing/vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { assert } from 'vite-plus/test';

import { workflowEvents, workflowReceipts } from './workflow-events.ts';

testStable('event receipts have a durable unique subscription identity', () => {
  const events = getTableConfig(workflowEvents);
  const receipts = getTableConfig(workflowReceipts);

  assert.strictEqual(events.name, 'workflow_events');
  assert.ok(
    receipts.indexes.some((index) => index.config.unique && index.config.columns.length === 4)
  );
});
