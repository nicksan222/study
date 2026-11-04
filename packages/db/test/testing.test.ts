import { existsSync } from 'node:fs';

import { testStable } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { assert } from 'vite-plus/test';

import { createTestDatabase } from '../src/testing.ts';

testStable('isolated fixtures use real migrated databases and remove their files', () => {
  const first = createTestDatabase();
  const second = createTestDatabase();
  const db = first.open();
  const other = second.open();

  try {
    assert.notStrictEqual(first.path, second.path);
    db.orm.run(sql`INSERT INTO projects (name, created_at, updated_at) VALUES ('first', 0, 0)`);
    assert.strictEqual(
      db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM projects`)!.count,
      1n
    );
    assert.strictEqual(
      other.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM projects`)!.count,
      0n
    );
  } finally {
    db.close();
    other.close();
    first.cleanup();
    second.cleanup();
  }

  assert.strictEqual(existsSync(first.dir), false);
  assert.strictEqual(existsSync(second.dir), false);
});
