import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { testStable } from '@study/testing/vitest';
import { eq, sql } from 'drizzle-orm';
import { assert, expect } from 'vite-plus/test';

import { Db } from '../src/index.ts';
import { material_generation_scopes } from '../src/schema.ts';

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

function privateConnection(path: string) {
  const db = Db.open(path);

  try {
    assert.strictEqual(db.path, path);
    assert.strictEqual(db.orm.get(sql.raw('PRAGMA journal_mode'))?.journal_mode, 'wal');
    assert.strictEqual(db.orm.get(sql.raw('PRAGMA foreign_keys'))?.foreign_keys, 1n);
    assert.strictEqual(db.orm.get(sql.raw('PRAGMA busy_timeout'))?.timeout, 30000n);

    if (process.platform !== 'win32') assert.strictEqual(statSync(path).mode & 0o777, 0o600);

    initialize(db);
    db.transaction(() => insert(db, 'persisted'));
  } finally {
    db.close();
  }

  if (process.platform !== 'win32') chmodSync(path, 0o644);

  const reopened = Db.open(path);

  try {
    if (process.platform !== 'win32') assert.strictEqual(statSync(path).mode & 0o777, 0o600);

    expect(values(reopened)).toStrictEqual(['persisted']);
  } finally {
    reopened.close();
  }
}

function nestedCommits(path: string) {
  const db = Db.open(path);

  try {
    initialize(db);
    const outside = db.orm;
    const marker = {};

    assert.strictEqual(
      db.transaction(() => {
        assert.notStrictEqual(db.orm, outside);
        const outer = db.orm;

        assert.strictEqual(
          db.transaction(() => {
            assert.notStrictEqual(db.orm, outer);
            insert(db, 'nested');

            return marker;
          }),
          marker
        );
        assert.strictEqual(db.orm, outer);

        return 42;
      }),
      42
    );
    assert.strictEqual(db.orm, outside);
    assert.throws(
      () =>
        db.transaction(() => {
          insert(db, 'outer rollback');
          db.transaction(() => insert(db, 'nested rollback'));

          throw new Error('stop');
        }),
      /stop/
    );
    assert.strictEqual(db.orm, outside);
    expect(values(db)).toStrictEqual(['nested']);
  } finally {
    db.close();
  }
}

function caughtNestedFailure(path: string) {
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
    expect(values(db)).toStrictEqual(['before', 'after']);
  } finally {
    db.close();
  }
}

function rejectedAsyncCallbacks(path: string) {
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
    assert.strictEqual(invoked, false);

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

    expect(values(db)).toStrictEqual([]);
  } finally {
    db.close();
  }
}

function assertExpiredCommit(db: Db) {
  assert.throws(() => insert(db, 'late commit write'), /transaction scope has ended/);
}

function assertExpiredScope(db: Db) {
  assert.throws(() => insert(db, 'late write'), /transaction scope has ended/);
  assert.throws(() => db.transaction(() => {}), /transaction scope has ended/);
  assert.throws(() => db.close(), /transaction scope has ended/);
  assert.throws(
    () => db.exec("INSERT INTO transaction_test VALUES ('late raw write')"),
    /transaction scope has ended/
  );
}

testStable(
  'opens a private WAL connection with foreign keys and a busy timeout, and persists across reopen',
  () => fixture(privateConnection)
);

testStable('opens an in-memory database and closes the underlying connection', () => {
  const db = Db.open(':memory:');

  assert.strictEqual(db.orm.get(sql.raw('PRAGMA foreign_keys'))?.foreign_keys, 1n);
  db.close();
  assert.throws(() => db.exec('SELECT 1'), /not open/);
});

testStable('nested commits return callback values and roll back with the outer transaction', () =>
  fixture(nestedCommits)
);

testStable('a caught nested failure rolls back its savepoint and preserves outer writes', () =>
  fixture(caughtNestedFailure)
);

testStable(
  'rejects native async callbacks before invocation and rolls back thenable callbacks',
  () => fixture(rejectedAsyncCallbacks)
);

async function expiredAsyncScopes() {
  const db = Db.open(':memory:');

  try {
    initialize(db);
    let continuation!: Promise<void>;

    assert.throws(
      () =>
        db.transaction(() => {
          insert(db, 'rolled back');
          continuation = Promise.resolve().then(() => assertExpiredScope(db));

          return continuation;
        }),
      TypeError
    );
    await continuation;
    expect(values(db)).toStrictEqual([]);
    db.transaction(() => {
      continuation = Promise.resolve().then(() => assertExpiredCommit(db));
      insert(db, 'committed');
    });
    await continuation;
    expect(values(db)).toStrictEqual(['committed']);
  } finally {
    db.close();
  }
}

testStable(
  'expired async scopes cannot use orm, start transactions, or close the database',
  expiredAsyncScopes
);

testStable(
  'boolean columns retain true and false alongside bigint integers across transactions and reopen',
  () =>
    fixture((path) => {
      const db = Db.open(path);

      try {
        db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'One',1,1);
        INSERT INTO material_generation_scopes(id,project_id,enabled,created_at,updated_at)
        VALUES('open',1,1,1,1),('closed',1,0,1,1),('retained',1,1,1,1)`);
        assert.strictEqual(
          db.orm
            .select()
            .from(material_generation_scopes)
            .where(eq(material_generation_scopes.id, 'open'))
            .get()?.enabled,
          true
        );
        assert.strictEqual(
          db.orm
            .select()
            .from(material_generation_scopes)
            .where(eq(material_generation_scopes.id, 'closed'))
            .get()?.enabled,
          false
        );
        db.transaction(() => {
          const row = db.orm
            .update(material_generation_scopes)
            .set({ enabled: false, updated_at: 2n })
            .where(eq(material_generation_scopes.id, 'open'))
            .returning()
            .get();

          assert.strictEqual(row?.enabled, false);
          assert.strictEqual(row?.project_id, 1n);
        });
      } finally {
        db.close();
      }

      const reopened = Db.open(path);

      try {
        const rows = reopened.orm.select().from(material_generation_scopes).all();

        assert.strictEqual(rows.length, 3);
        expect(Object.fromEntries(rows.map((row) => [row.id, row.enabled]))).toStrictEqual({
          open: false,
          closed: false,
          retained: true
        });
        assert.ok(rows.every((row) => row.project_id === 1n));
      } finally {
        reopened.close();
      }
    })
);
