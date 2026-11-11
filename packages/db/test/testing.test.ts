import { BunFileSystem } from '@effect/platform-bun';
import { testStable } from '@study/testing/vitest';
import { sql } from 'drizzle-orm';
import { Effect, FileSystem } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Db } from '../src/db.ts';
import { createTestDatabase } from '../src/testing.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

testStable('fixture preparation is explicit and supports direct connections', async () => {
  const fixture = await createTestDatabase();

  assert.strictEqual(await Effect.runPromise(fs.exists(fixture.path)), false);
  assert.strictEqual(await fixture.prepare(), fixture.path);
  const db = await Db.open(fixture.path);

  try {
    assert.strictEqual(
      db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM projects`)!.count,
      0n
    );
  } finally {
    db.close();
    await fixture.cleanup();
  }
});

testStable('isolated fixtures use real migrated databases and remove their files', async () => {
  const first = await createTestDatabase();
  const second = await createTestDatabase();
  const db = await first.open();
  const other = await second.open();

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
    await first.cleanup();
    await second.cleanup();
  }

  assert.strictEqual(await Effect.runPromise(fs.exists(first.dir)), false);
  assert.strictEqual(await Effect.runPromise(fs.exists(second.dir)), false);
});

testStable(
  'reopening a fixture preserves writes instead of restoring the empty template',
  async () => {
    const fixture = await createTestDatabase();
    const first = await fixture.open();

    first.orm.run(
      sql`INSERT INTO projects (name, created_at, updated_at) VALUES ('retained', 0, 0)`
    );
    first.close();
    const reopened = await fixture.open();

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
      await fixture.cleanup();
    }
  }
);

testStable('custom migration folders bypass the default database template', async () => {
  const fixture = await createTestDatabase('/missing-study-test-migrations');

  try {
    assert.strictEqual(await Effect.runPromise(fs.exists(fixture.path)), false);
    await expect(fixture.open()).rejects.toThrow();
  } finally {
    await fixture.cleanup();
  }
});
