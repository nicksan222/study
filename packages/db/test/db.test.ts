import { BunFileSystem } from '@effect/platform-bun';
import { testStable } from '@study/testing/vitest';
import { eq, sql } from 'drizzle-orm';
import { Effect, FileSystem } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Db } from '../src/index.ts';
import type { DbTransaction } from '../src/index.ts';
import { material_generation_scopes, projects } from '../src/schema.ts';
import { createTestDatabase } from '../src/testing.ts';

async function fixture(run: (path: string) => void | Promise<void>) {
  const location = await createTestDatabase();

  try {
    await run(location.path);
  } finally {
    await location.cleanup();
  }
}

const filesystem = Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

function initialize(db: Db) {
  db.orm.run(sql`CREATE TABLE transaction_test (value TEXT NOT NULL)`);
}

function insert(db: Db | DbTransaction, value: string) {
  db.orm.run(sql`INSERT INTO transaction_test VALUES (${value})`);
}

function values(db: Db) {
  return db.orm
    .all<{ value: string }>(sql`SELECT value FROM transaction_test ORDER BY rowid`)
    .map((row) => row.value);
}

async function privateConnection(path: string) {
  const db = await Db.open(path);

  try {
    assert.strictEqual(db.path, path);
    assert.strictEqual(db.orm.get(sql.raw('PRAGMA journal_mode'))?.journal_mode, 'wal');
    assert.strictEqual(db.orm.get(sql.raw('PRAGMA foreign_keys'))?.foreign_keys, 1n);
    assert.strictEqual(db.orm.get(sql.raw('PRAGMA busy_timeout'))?.timeout, 30000n);

    if (process.platform !== 'win32')
      assert.strictEqual(
        (await Effect.runPromise((await filesystem).stat(path))).mode & 0o777,
        0o600
      );

    initialize(db);
    db.transaction((tx) => insert(tx, 'persisted'));
  } finally {
    db.close();
  }

  if (process.platform !== 'win32') await Effect.runPromise((await filesystem).chmod(path, 0o644));

  const reopened = await Db.open(path);

  try {
    if (process.platform !== 'win32')
      assert.strictEqual(
        (await Effect.runPromise((await filesystem).stat(path))).mode & 0o777,
        0o600
      );

    expect(values(reopened)).toStrictEqual(['persisted']);
  } finally {
    reopened.close();
  }
}

async function nestedCommits(path: string) {
  const db = await Db.open(path);

  try {
    initialize(db);
    const outside = db.orm;
    const marker = {};

    assert.strictEqual(
      db.transaction((outer) => {
        assert.notStrictEqual(outer.orm, outside);
        assert.strictEqual(
          outer.transaction((inner) => {
            assert.notStrictEqual(inner.orm, outer.orm);
            insert(inner, 'nested');

            return marker;
          }),
          marker
        );

        return 42;
      }),
      42
    );
    assert.strictEqual(db.orm, outside);
    assert.throws(
      () =>
        db.transaction((outer) => {
          insert(outer, 'outer rollback');
          outer.transaction((inner) => insert(inner, 'nested rollback'));

          throw new Error('stop');
        }),
      /stop/
    );
    expect(values(db)).toStrictEqual(['nested']);
  } finally {
    db.close();
  }
}

async function caughtNestedFailure(path: string) {
  const db = await Db.open(path);

  try {
    initialize(db);
    db.transaction((outer) => {
      insert(outer, 'before');
      assert.throws(
        () =>
          outer.transaction((inner) => {
            insert(inner, 'discarded');

            throw new Error('nested failure');
          }),
        /nested failure/
      );
      insert(outer, 'after');
    });
    expect(values(db)).toStrictEqual(['before', 'after']);
  } finally {
    db.close();
  }
}

async function rejectedAsyncCallbacks(path: string) {
  const db = await Db.open(path);

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
          db.transaction((tx) => {
            insert(tx, 'discarded');

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

function assertExpiredCommit(db: DbTransaction) {
  assert.throws(() => insert(db, 'late commit write'), /transaction scope has ended/);
}

function assertExpiredScope(db: DbTransaction) {
  assert.throws(() => insert(db, 'late write'), /transaction scope has ended/);
  assert.throws(() => db.transaction(() => {}), /transaction scope has ended/);
  assert.throws(
    () => db.exec("INSERT INTO transaction_test VALUES ('late raw write')"),
    /transaction scope has ended/
  );
}

testStable(
  'opens a private WAL connection with foreign keys and a busy timeout, and persists across reopen',
  () => fixture(privateConnection)
);

testStable('opens an in-memory database and closes the underlying connection', async () => {
  const db = await Db.open(':memory:');

  assert.strictEqual(db.orm.get(sql.raw('PRAGMA foreign_keys'))?.foreign_keys, 1n);
  db.close();
  assert.throws(() => db.exec('SELECT 1'), /closed/);
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
  const db = await Db.open(':memory:');

  try {
    initialize(db);
    let continuation!: Promise<void>;

    assert.throws(
      () =>
        db.transaction((tx) => {
          insert(tx, 'rolled back');
          continuation = Promise.resolve().then(() => assertExpiredScope(tx));

          return continuation;
        }),
      TypeError
    );
    await continuation;
    expect(values(db)).toStrictEqual([]);
    db.transaction((tx) => {
      continuation = Promise.resolve().then(() => assertExpiredCommit(tx));
      insert(tx, 'committed');
    });
    await continuation;
    expect(values(db)).toStrictEqual(['committed']);
  } finally {
    db.close();
  }
}

testStable(
  'expired async scopes cannot use orm, raw SQL, or start transactions',
  expiredAsyncScopes
);

testStable(
  'boolean columns retain true and false alongside bigint integers across transactions and reopen',
  () =>
    fixture(async (path) => {
      const db = await Db.open(path);

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
        db.transaction((tx) => {
          const row = tx.orm
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

      const reopened = await Db.open(path);

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

testStable('transaction capabilities expire after commit', () =>
  fixture(async (path) => {
    const db = await Db.open(path);

    try {
      initialize(db);
      let escaped: { orm: typeof db.orm } | undefined;
      let escapedOrm: typeof db.orm | undefined;
      let escapedRun: (() => unknown) | undefined;

      db.transaction((tx) => {
        escaped = tx;
        escapedOrm = tx.orm;
        const run = tx.orm.run;

        escapedRun = () => run(sql`INSERT INTO transaction_test VALUES ('late method')`);
        tx.orm.run(sql`INSERT INTO transaction_test VALUES ('scoped')`);
      });
      assert.throws(
        () => escaped!.orm.run(sql`INSERT INTO transaction_test VALUES ('late')`),
        /transaction scope has ended/
      );
      assert.throws(
        () => escapedOrm!.run(sql`INSERT INTO transaction_test VALUES ('late')`),
        /transaction scope has ended/
      );
      assert.throws(() => escapedRun!(), /transaction scope has ended/);
      expect(values(db)).toStrictEqual(['scoped']);
    } finally {
      db.close();
    }
  })
);

testStable('SQLite cannot load extensions from SQL after vector setup', async () => {
  const db = await Db.open(':memory:');

  try {
    assert.throws(() => db.orm.get(sql`SELECT load_extension('untrusted')`));
  } finally {
    db.close();
  }
});

testStable('root access cannot replace a transaction capability', () =>
  fixture(async (path) => {
    const db = await Db.open(path);

    try {
      initialize(db);
      const root = db.orm;
      const writeRoot = () => root.run(sql`INSERT INTO transaction_test VALUES ('root')`);

      db.transaction((tx) => {
        assert.throws(writeRoot, /transaction capability/);
        tx.orm.run(sql`INSERT INTO transaction_test VALUES ('scoped')`);
      });
      expect(values(db)).toStrictEqual(['scoped']);
    } finally {
      db.close();
    }
  })
);

testStable('ORM-level transactions cannot bypass database capabilities', async () => {
  const db = await Db.open(':memory:');
  let invoked = false;
  const bypass = (orm: Db['orm']) =>
    Reflect.apply(Reflect.get(orm, 'transaction'), orm, [
      () => {
        invoked = true;
      }
    ]);

  try {
    assert.throws(() => bypass(db.orm), /transaction capability/);
    db.transaction((tx) => {
      assert.throws(() => bypass(tx.orm), /transaction capability/);
    });
    assert.strictEqual(invoked, false);
  } finally {
    db.close();
  }
});

testStable('CTE APIs and builders expire with their transaction capability', async () => {
  const db = await Db.open(':memory:');
  let lateWrite!: () => unknown;
  let lateQuery!: () => unknown;

  try {
    db.transaction((tx) => {
      const scoped = tx.orm.with();
      const query = scoped
        .insert(projects)
        .values({ name: 'late query', created_at: 1n, updated_at: 1n });

      lateWrite = () =>
        scoped
          .insert(projects)
          .values({ name: 'late write', created_at: 1n, updated_at: 1n })
          .run();
      lateQuery = () => query.run();
      scoped.insert(projects).values({ name: 'scoped', created_at: 1n, updated_at: 1n }).run();
    });
    assert.throws(lateWrite, /transaction scope has ended/);
    assert.throws(lateQuery, /transaction scope has ended/);
    expect(db.orm.select({ name: projects.name }).from(projects).all()).toStrictEqual([
      { name: 'scoped' }
    ]);
  } finally {
    db.close();
  }
});

testStable('captured root CTE APIs cannot execute inside a transaction', async () => {
  const db = await Db.open(':memory:');

  try {
    const outside = db.orm.with();

    db.transaction(() => {
      assert.throws(
        () =>
          outside.insert(projects).values({ name: 'root', created_at: 1n, updated_at: 1n }).run(),
        /transaction capability/
      );
    });
    expect(db.orm.select({ name: projects.name }).from(projects).all()).toStrictEqual([]);
  } finally {
    db.close();
  }
});
