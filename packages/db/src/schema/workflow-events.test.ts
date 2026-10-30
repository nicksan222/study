import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { getTableConfig } from 'drizzle-orm/sqlite-core';

import { workflowEvents, workflowReceipts } from './workflow-events.ts';

test('event receipts have a durable unique subscription identity', () => {
  const events = getTableConfig(workflowEvents);
  const receipts = getTableConfig(workflowReceipts);

  assert.equal(events.name, 'workflow_events');
  assert.ok(
    receipts.indexes.some((index) => index.config.unique && index.config.columns.length === 4)
  );
});
