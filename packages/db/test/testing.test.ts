import { existsSync } from 'node:fs';

import { testStable } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { assert } from 'vite-plus/test';

import { Db } from '../src/db.ts';
import { createTestDatabase } from '../src/testing.ts';

testStable('fixture preparation is explicit and supports direct connections', () => {
  const fixture = createTestDatabase();

  assert.strictEqual(existsSync(fixture.path), false);
  assert.strictEqual(fixture.prepare(), fixture.path);
  const db = Db.open(fixture.path);

  try {
    assert.strictEqual(
      db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM projects`)!.count,
      0n
    );
  } finally {
    db.close();
    fixture.cleanup();
  }
});

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

testStable('reopening a fixture preserves writes instead of restoring the empty template', () => {
  const fixture = createTestDatabase();
  const first = fixture.open();

  first.orm.run(sql`INSERT INTO projects (name, created_at, updated_at) VALUES ('retained', 0, 0)`);
  first.close();
  const reopened = fixture.open();

  try {
    assert.strictEqual(
      reopened.orm.get<{ name: string }>(sql`SELECT name FROM projects`)!.name,
      'retained'
    );
    assert.strictEqual(reopened.orm.get(sql`PRAGMA journal_mode`)!.journal_mode, 'wal');
    assert.strictEqual(reopened.orm.get(sql`PRAGMA foreign_keys`)!.foreign_keys, 1n);
    assert.strictEqual(reopened.orm.get(sql`PRAGMA recursive_triggers`)!.recursive_triggers, 1n);
  } finally {
    reopened.close();
    fixture.cleanup();
  }
});

testStable('custom migration folders bypass the default database template', () => {
  const fixture = createTestDatabase('/missing-study-test-migrations');

  try {
    assert.strictEqual(existsSync(fixture.path), false);
    assert.throws(() => fixture.open());
  } finally {
    fixture.cleanup();
  }
});
