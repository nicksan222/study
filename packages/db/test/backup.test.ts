import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { testStable } from '@study/testing/node';

import { Db } from '../src/db.ts';
import { sql } from '../src/index.ts';
import { createTestDatabase } from '../src/testing.ts';

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

          assert.equal(rows.length, 2);
          assert.equal(rows[0]!.revision, rows[1]!.revision);
          assert.ok(rows[0]!.revision === 1n || rows[0]!.revision === 2n);
          assert.equal(rows[0]!.bytes, 1024n * 1024n);
          assert.equal(
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
      assert.equal(Db.validateSnapshot(target), db.schemaIdentity());

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
      assert.equal(db.schemaIdentity().length, 64);
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
    assert.equal(existsSync(target), false);
  } finally {
    db.close();
    location.cleanup();
  }
});
