import { BunFileSystem } from '@effect/platform-bun';
import { test } from '@study/testing';
import { sql } from 'drizzle-orm';
import { Effect, FileSystem } from 'effect';

import { Db } from '../src/db.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

test.server.stable(
  'fixture disposal closes owned connections and removes files after an exception',
  async ({ expect, createTestDatabase, assert: assertions }) => {
    const assert: test.Assert = assertions;

    let directory = '';
    let connection: Db | undefined;

    await expect(
      (async () => {
        await using fixture = await createTestDatabase();

        directory = fixture.dir;
        connection = await fixture.open();
        connection.orm.run(
          sql`INSERT INTO projects (name, created_at, updated_at) VALUES ('owned', 0, 0)`
        );

        throw new Error('scenario failed');
      })()
    ).rejects.toThrow('scenario failed');
    assert.throws(() => connection!.exec('SELECT 1'));
    expect(await Effect.runPromise(fs.exists(directory))).toBe(false);
  }
);

test.server.stable(
  'fixture preparation is explicit and supports direct connections',
  async ({ createTestDatabase, assert: assertions }) => {
    const assert: test.Assert = assertions;

    await using fixture = await createTestDatabase();

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
  }
);

test.server.stable(
  'isolated fixtures use real migrated databases and remove their files',
  async ({ createTestDatabase, assert: assertions }) => {
    const assert: test.Assert = assertions;

    await using first = await createTestDatabase();
    await using second = await createTestDatabase();
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
  }
);

test.server.stable(
  'reopening a fixture preserves writes instead of restoring the empty template',
  async ({ createTestDatabase, assert: assertions }) => {
    const assert: test.Assert = assertions;

    await using fixture = await createTestDatabase();
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

test.server.stable(
  'custom migration folders bypass the default database template',
  async ({ createTestDatabase, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    await using fixture = await createTestDatabase('/missing-study-test-migrations');

    try {
      assert.strictEqual(await Effect.runPromise(fs.exists(fixture.path)), false);
      await expect(fixture.open()).rejects.toThrow();
    } finally {
      await fixture.cleanup();
    }
  }
);
