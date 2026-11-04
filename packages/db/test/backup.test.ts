import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { Db } from '../src/db.ts';
import { sql } from '../src/index.ts';
import { createTestDatabase } from '../src/testing.ts';

const execute = promisify(execFile);

testStable('online backup delivers completion while the event loop is otherwise idle', async () => {
  const location = createTestDatabase();

  const db = location.open();

  db.close();

  const env = { ...process.env };

  delete env.NODE_TEST_CONTEXT;
  env.STUDY_BACKUP_IDLE_SOURCE = location.path;
  env.STUDY_BACKUP_IDLE_TARGET = join(location.dir, 'idle.sqlite');

  try {
    await execute(
      process.execPath,
      [fileURLToPath(new URL('./fixtures/backup-idle.ts', import.meta.url))],
      { timeout: 15000, env }
    );
  } finally {
    location.cleanup();
  }
});

testStable(
  'online backup during a concurrent transaction yields one coherent committed snapshot',
  async () => {
    const location = createTestDatabase();

    const db = location.open();

    try {
      // More than the backup API batch size: backup must traverse multiple steps.
      db.exec(
        'CREATE TABLE backup_pair(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload BLOB NOT NULL)'
      );

      const writer = Db.open(location.path);

      try {
        for (const id of [1, 2])
          writer.orm.run(
            sql`INSERT INTO backup_pair VALUES(${id},1,${Buffer.alloc(1024 * 1024, 1)})`
          );

        const target = join(location.dir, 'snapshot.sqlite');

        const copying = db.snapshot(target, 8 * 1024 * 1024);

        writer.exec('BEGIN IMMEDIATE; UPDATE backup_pair SET revision=2; COMMIT;');
        await copying;

        const snapshot = Db.open(target);

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
      location.cleanup();
    }
  }
);

testStable(
  'supported snapshots reject extra executable schema before writable acquisition',
  async () => {
    const location = createTestDatabase();

    const db = location.open();

    const target = join(location.dir, 'snapshot.sqlite');

    try {
      await db.snapshot(target);
      assert.strictEqual(Db.validateSnapshot(target), db.schemaIdentity());

      const untrusted = Db.openSnapshot(target);

      try {
        untrusted.exec(
          'CREATE TRIGGER untrusted AFTER INSERT ON projects BEGIN DELETE FROM sources; END;'
        );
      } finally {
        untrusted.close();
      }

      assert.throws(() => Db.validateSnapshot(target));
      assert.throws(() => Db.openSnapshot(target));
      assert.strictEqual(db.schemaIdentity().length, 64);
    } finally {
      db.close();
      location.cleanup();
    }
  }
);

testStable('snapshot allocation bounds reject before creating a destination file', () => {
  const location = createTestDatabase();

  const db = location.open();

  const target = join(location.dir, 'bounded.sqlite');

  try {
    assert.throws(() => db.snapshot(target, 1), RangeError);
    assert.strictEqual(existsSync(target), false);
  } finally {
    db.close();
    location.cleanup();
  }
});
