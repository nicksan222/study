import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { sql } from 'drizzle-orm';

import { createTestDatabase } from '../src/testing.ts';

test('isolated fixtures use real migrated databases and remove their files', () => {
  const first = createTestDatabase();
  const second = createTestDatabase();
  const db = first.open();
  const other = second.open();

  try {
    assert.notEqual(first.path, second.path);
    db.orm.run(sql`INSERT INTO projects (name, created_at, updated_at) VALUES ('first', 0, 0)`);
    assert.equal(
      db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM projects`)!.count,
      1n
    );
    assert.equal(
      other.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM projects`)!.count,
      0n
    );
  } finally {
    db.close();
    other.close();
    first.cleanup();
    second.cleanup();
  }

  assert.equal(existsSync(first.dir), false);
  assert.equal(existsSync(second.dir), false);
});
