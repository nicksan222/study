import { BunFileSystem } from '@effect/platform-bun';
import { test } from '@study/testing';
import { sql } from 'drizzle-orm';
import { Effect, FileSystem } from 'effect';

import { Db } from '../src/db.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

test.stable(
  'fixture disposal closes owned connections and removes files after an exception',
  async () => {
    let directory = '';
    let connection: Db | undefined;

    await test
      .expect(
        (async () => {
          await using fixture = await test.createTestDatabase();

          directory = fixture.dir;
          connection = await fixture.open();
          connection.orm.run(
            sql`INSERT INTO projects (name, created_at, updated_at) VALUES ('owned', 0, 0)`
          );

          throw new Error('scenario failed');
        })()
      )
      .rejects.toThrow('scenario failed');
    test.assert.throws(() => connection!.exec('SELECT 1'));
    test.expect(await Effect.runPromise(fs.exists(directory))).toBe(false);
  }
);

test.stable('fixture preparation is explicit and supports direct connections', async () => {
  await using fixture = await test.createTestDatabase();

  test.assert.strictEqual(await Effect.runPromise(fs.exists(fixture.path)), false);
  test.assert.strictEqual(await fixture.prepare(), fixture.path);
  const db = await Db.open(fixture.path);

  try {
    test.assert.strictEqual(
      db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM projects`)!.count,
      0n
    );
  } finally {
    db.close();
    await fixture.cleanup();
  }
});

test.stable('isolated fixtures use real migrated databases and remove their files', async () => {
  await using first = await test.createTestDatabase();
  await using second = await test.createTestDatabase();
  const db = await first.open();
  const other = await second.open();

  try {
    test.assert.notStrictEqual(first.path, second.path);
    db.orm.run(sql`INSERT INTO projects (name, created_at, updated_at) VALUES ('first', 0, 0)`);
    test.assert.strictEqual(
      db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM projects`)!.count,
      1n
    );
    test.assert.strictEqual(
      other.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM projects`)!.count,
      0n
    );
  } finally {
    db.close();
    other.close();
    await first.cleanup();
    await second.cleanup();
  }

  test.assert.strictEqual(await Effect.runPromise(fs.exists(first.dir)), false);
  test.assert.strictEqual(await Effect.runPromise(fs.exists(second.dir)), false);
});

test.stable(
  'reopening a fixture preserves writes instead of restoring the empty template',
  async () => {
    await using fixture = await test.createTestDatabase();
    const first = await fixture.open();

    first.orm.run(
      sql`INSERT INTO projects (name, created_at, updated_at) VALUES ('retained', 0, 0)`
    );
    first.close();
    const reopened = await fixture.open();

    try {
      test.assert.strictEqual(
        reopened.orm.get<{ name: string }>(sql`SELECT name FROM projects`)!.name,
        'retained'
      );
      test.assert.strictEqual(reopened.orm.get(sql`PRAGMA journal_mode`)!.journal_mode, 'wal');
      test.assert.strictEqual(reopened.orm.get(sql`PRAGMA foreign_keys`)!.foreign_keys, 1n);
      test.assert.strictEqual(
        reopened.orm.get(sql`PRAGMA recursive_triggers`)!.recursive_triggers,
        1n
      );
    } finally {
      reopened.close();
      await fixture.cleanup();
    }
  }
);

test.stable('custom migration folders bypass the default database template', async () => {
  await using fixture = await test.createTestDatabase('/missing-study-test-migrations');

  try {
    test.assert.strictEqual(await Effect.runPromise(fs.exists(fixture.path)), false);
    await test.expect(fixture.open()).rejects.toThrow();
  } finally {
    await fixture.cleanup();
  }
});
