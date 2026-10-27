import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { sql } from 'drizzle-orm';

import { Db } from '../src/index.ts';

function fixture(run: (path: string) => void) {
  const folder = mkdtempSync(join(tmpdir(), 'study-db-'));

  try {
    run(join(folder, 'study.db'));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function initialize(db: Db) {
  db.orm.run(sql`CREATE TABLE transaction_test (value TEXT NOT NULL)`);
}

function insert(db: Db, value: string) {
  db.orm.run(sql`INSERT INTO transaction_test VALUES (${value})`);
}

function values(db: Db) {
  return db.orm
    .all<{ value: string }>(sql`SELECT value FROM transaction_test ORDER BY rowid`)
    .map((row) => row.value);
}

test('opens a private WAL connection with foreign keys and a busy timeout, and persists across reopen', () =>
  fixture((path) => {
    const db = Db.open(path);

    try {
      assert.equal(db.path, path);
      assert.equal(db.orm.get(sql.raw('PRAGMA journal_mode'))?.journal_mode, 'wal');
      assert.equal(db.orm.get(sql.raw('PRAGMA foreign_keys'))?.foreign_keys, 1n);
      assert.equal(db.orm.get(sql.raw('PRAGMA busy_timeout'))?.timeout, 30000n);

      if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);

      initialize(db);
      db.transaction(() => insert(db, 'persisted'));
    } finally {
      db.close();
    }

    if (process.platform !== 'win32') chmodSync(path, 0o644);

    const reopened = Db.open(path);

    try {
      if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);

      assert.deepEqual(values(reopened), ['persisted']);
    } finally {
      reopened.close();
    }
  }));

test('opens an in-memory database and closes the underlying connection', () => {
  const db = Db.open(':memory:');

  assert.equal(db.orm.get(sql.raw('PRAGMA foreign_keys'))?.foreign_keys, 1n);
  db.close();
  assert.throws(() => db.exec('SELECT 1'), /not open/);
});

test('nested commits return callback values and roll back with the outer transaction', () =>
  fixture((path) => {
    const db = Db.open(path);

    try {
      initialize(db);
      const outside = db.orm;
      const marker = {};

      assert.equal(
        db.transaction(() => {
          assert.notEqual(db.orm, outside);
          const outer = db.orm;

          assert.equal(
            db.transaction(() => {
              assert.notEqual(db.orm, outer);
              insert(db, 'nested');

              return marker;
            }),
            marker
          );
          assert.equal(db.orm, outer);

          return 42;
        }),
        42
      );
      assert.equal(db.orm, outside);
      assert.throws(
        () =>
          db.transaction(() => {
            insert(db, 'outer rollback');
            db.transaction(() => insert(db, 'nested rollback'));

            throw new Error('stop');
          }),
        /stop/
      );
      assert.equal(db.orm, outside);
      assert.deepEqual(values(db), ['nested']);
    } finally {
      db.close();
    }
  }));

test('a caught nested failure rolls back its savepoint and preserves outer writes', () =>
  fixture((path) => {
    const db = Db.open(path);

    try {
      initialize(db);
      db.transaction(() => {
        insert(db, 'before');
        assert.throws(
          () =>
            db.transaction(() => {
              insert(db, 'discarded');

              throw new Error('nested failure');
            }),
          /nested failure/
        );
        insert(db, 'after');
      });
      assert.deepEqual(values(db), ['before', 'after']);
    } finally {
      db.close();
    }
  }));

test('rejects native async callbacks before invocation and rolls back thenable callbacks', () =>
  fixture((path) => {
    const db = Db.open(path);

    try {
      initialize(db);
      let invoked = false;

      assert.throws(
        () =>
          db.transaction(async () => {
            invoked = true;
          }),
        TypeError
      );
      assert.equal(invoked, false);

      // oxlint-disable-next-line unicorn/no-thenable -- Exercise rejection of thenable transaction callbacks.
      for (const thenable of [{ then() {} }, Object.assign(() => {}, { then() {} })]) {
        assert.throws(
          () =>
            db.transaction(() => {
              insert(db, 'discarded');

              return thenable;
            }),
          TypeError
        );
      }

      assert.deepEqual(values(db), []);
    } finally {
      db.close();
    }
  }));

test('expired async scopes cannot use orm, start transactions, or close the database', async () => {
  const db = Db.open(':memory:');

  try {
    initialize(db);
    let continuation!: Promise<void>;

    assert.throws(
      () =>
        db.transaction(() => {
          insert(db, 'rolled back');
          continuation = Promise.resolve().then(() => {
            assert.throws(() => insert(db, 'late write'), /transaction scope has ended/);
            assert.throws(() => db.transaction(() => {}), /transaction scope has ended/);
            assert.throws(() => db.close(), /transaction scope has ended/);
            assert.throws(
              () => db.exec("INSERT INTO transaction_test VALUES ('late raw write')"),
              /transaction scope has ended/
            );
          });

          return continuation;
        }),
      TypeError
    );
    await continuation;
    assert.deepEqual(values(db), []);
    db.transaction(() => {
      continuation = Promise.resolve().then(() => {
        assert.throws(() => insert(db, 'late commit write'), /transaction scope has ended/);
      });
      insert(db, 'committed');
    });
    await continuation;
    assert.deepEqual(values(db), ['committed']);
  } finally {
    db.close();
  }
});
