import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { Db } from '../src/db.ts';
import { createTestDatabase } from '../src/testing.ts';

test('online backup during a concurrent transaction yields one coherent committed snapshot', async () => {
  const location = createTestDatabase();
  const db = location.open();
  try {
    // More than the backup API batch size: backup must traverse multiple steps.
    db.exec(
      'CREATE TABLE backup_pair(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload BLOB NOT NULL)'
    );
    const writer = new DatabaseSync(location.path);
    try {
      const insert = writer.prepare('INSERT INTO backup_pair VALUES(?,?,?)');
      insert.run(1, 1, Buffer.alloc(1024 * 1024, 1));
      insert.run(2, 1, Buffer.alloc(1024 * 1024, 1));
      const target = join(location.dir, 'snapshot.sqlite');
      const copying = db.snapshot(target, 8 * 1024 * 1024);
      writer.exec('BEGIN IMMEDIATE; UPDATE backup_pair SET revision=2; COMMIT;');
      await copying;
      const snapshot = new DatabaseSync(target, { readOnly: true });
      try {
        const rows = snapshot
          .prepare('SELECT revision,length(payload) bytes FROM backup_pair ORDER BY id')
          .all();
        assert.equal(rows.length, 2);
        assert.equal(rows[0]!.revision, rows[1]!.revision);
        assert.ok(rows[0]!.revision === 1 || rows[0]!.revision === 2);
        assert.equal(rows[0]!.bytes, 1024 * 1024);
        assert.equal(snapshot.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
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
});

test('supported snapshots reject extra executable schema before writable acquisition', async () => {
  const location = createTestDatabase();
  const db = location.open();
  const target = join(location.dir, 'snapshot.sqlite');
  try {
    await db.snapshot(target);
    assert.equal(Db.validateSnapshot(target), db.schemaIdentity());
    const untrusted = new DatabaseSync(target);
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
});
