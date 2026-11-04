import { testStable } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { expect } from 'vite-plus/test';

import { createTestDatabase } from '../src/testing.ts';

testStable('workflow pagination queries can use the matching SQLite indexes', () => {
  const location = createTestDatabase();
  const db = location.open();

  try {
    const plans = [
      db.orm.all<{ detail: string }>(
        sql`EXPLAIN QUERY PLAN SELECT execution_id FROM workflow_executions ORDER BY created_at DESC, execution_id DESC LIMIT 10`
      ),
      db.orm.all<{ detail: string }>(
        sql`EXPLAIN QUERY PLAN SELECT execution_id FROM workflow_executions WHERE json_extract(payload, '$.event.correlationId') = 'correlation' ORDER BY created_at DESC, execution_id DESC LIMIT 10`
      )
    ];

    expect(plans[0]![0]!.detail).toMatch(/workflow_executions_pagination_idx/);
    expect(plans[1]![0]!.detail).toMatch(/workflow_executions_correlation_pagination_idx/);
  } finally {
    db.close();
    location.cleanup();
  }
});
