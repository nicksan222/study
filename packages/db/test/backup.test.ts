import { BunPath } from '@effect/platform-bun';
import { testStable } from '@study/testing/vitest';
import { Effect, Path } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Db } from '../src/db.ts';
import { sql } from '../src/index.ts';
import { createTestDatabase } from '../src/testing.ts';

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

testStable('online backup delivers completion while the event loop is otherwise idle', async () => {
  const location = await createTestDatabase();

  const db = await location.open();

  db.close();

  const env = { ...process.env };

  delete env.NODE_TEST_CONTEXT;
  env.STUDY_BACKUP_IDLE_SOURCE = location.path;
  env.STUDY_BACKUP_IDLE_TARGET = join(location.dir, 'idle.sqlite');

  try {
    const child = Bun.spawn(
      [process.execPath, Bun.fileURLToPath(new URL('./fixtures/backup-idle.ts', import.meta.url))],
      {
        env,
        signal: AbortSignal.timeout(15000),
        stdout: 'pipe',
        stderr: 'pipe'
      }
    );
    const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

    assert.strictEqual(status, 0, stderr);
  } finally {
    await location.cleanup();
  }
});

testStable(
  'online backup during a concurrent transaction yields one coherent committed snapshot',
  async () => {
    const location = await createTestDatabase();

    const db = await location.open();

    try {
      // More than the backup API batch size: backup must traverse multiple steps.
      db.exec(
        'CREATE TABLE backup_pair(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload BLOB NOT NULL)'
      );

      const writer = await Db.open(location.path);

      try {
        for (const id of [1, 2])
          writer.orm.run(
            sql`INSERT INTO backup_pair VALUES(${id},1,${Buffer.alloc(1024 * 1024, 1)})`
          );

        const target = join(location.dir, 'snapshot.sqlite');

        const copying = db.snapshot(target, 8 * 1024 * 1024);

        writer.exec('BEGIN IMMEDIATE; UPDATE backup_pair SET revision=2; COMMIT;');
        await copying;

        const snapshot = await Db.open(target);

        try {
          const rows = snapshot.orm.all<{ revision: bigint; bytes: bigint }>(
            sql`SELECT revision,length(payload) bytes FROM backup_pair ORDER BY id`
          );

          assert.strictEqual(rows.length, 2);
          assert.strictEqual(rows[0]!.revision, rows[1]!.revision);
          assert.ok(rows[0]!.revision === 1n || rows[0]!.revision === 2n);
          assert.strictEqual(rows[0]!.bytes, 1024n * 1024n);
          assert.strictEqual(
            snapshot.orm.get<{ integrity_check: string }>(sql`PRAGMA integrity_check`)!
              .integrity_check,
            'ok'
          );
        } finally {
          snapshot.close();
        }
      } finally {
        writer.close();
      }
    } finally {
      db.close();
      await location.cleanup();
    }
  }
);

testStable(
  'supported snapshots reject extra executable schema before writable acquisition',
  async () => {
    const location = await createTestDatabase();

    const db = await location.open();

    const target = join(location.dir, 'snapshot.sqlite');

    try {
      await db.snapshot(target);
      assert.strictEqual(await Db.validateSnapshot(target), db.schemaIdentity());

      const untrusted = await Db.openSnapshot(target);

      try {
        untrusted.exec(
          'CREATE TRIGGER untrusted AFTER INSERT ON projects BEGIN DELETE FROM sources; END;'
        );
      } finally {
        untrusted.close();
      }

      await expect(Db.validateSnapshot(target)).rejects.toThrow();
      await expect(Db.openSnapshot(target)).rejects.toThrow();
      assert.strictEqual(db.schemaIdentity().length, 64);
    } finally {
      db.close();
      await location.cleanup();
    }
  }
);

testStable('snapshot allocation bounds reject before creating a destination file', async () => {
  const location = await createTestDatabase();

  const db = await location.open();

  const target = join(location.dir, 'bounded.sqlite');

  try {
    assert.throws(() => db.snapshot(target, 1), RangeError);
    assert.strictEqual(await Bun.file(target).exists(), false);
  } finally {
    db.close();
    await location.cleanup();
  }
});
