import { BunFileSystem } from '@effect/platform-bun';
import { test } from '@study/testing';
import { eq, sql } from 'drizzle-orm';
import { Effect, FileSystem } from 'effect';

import { Db } from '../src/index.ts';
import type { DbTransaction } from '../src/index.ts';
import { material_generation_scopes, projects } from '../src/schema.ts';

async function fixture(run: (path: string) => void | Promise<void>) {
  const location = await test.createTestDatabase();

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
    test.assert.strictEqual(db.path, path);
    test.assert.strictEqual(db.orm.get(sql.raw('PRAGMA journal_mode'))?.journal_mode, 'wal');
    test.assert.strictEqual(db.orm.get(sql.raw('PRAGMA foreign_keys'))?.foreign_keys, 1n);
    test.assert.strictEqual(db.orm.get(sql.raw('PRAGMA busy_timeout'))?.timeout, 30000n);

    if (process.platform !== 'win32')
      test.assert.strictEqual(
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
      test.assert.strictEqual(
        (await Effect.runPromise((await filesystem).stat(path))).mode & 0o777,
        0o600
      );

    test.expect(values(reopened)).toStrictEqual(['persisted']);
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

    test.assert.strictEqual(
      db.transaction((outer) => {
        test.assert.notStrictEqual(outer.orm, outside);
        test.assert.strictEqual(
          outer.transaction((inner) => {
            test.assert.notStrictEqual(inner.orm, outer.orm);
            insert(inner, 'nested');

            return marker;
          }),
          marker
        );

        return 42;
      }),
      42
    );
    test.assert.strictEqual(db.orm, outside);
    test.assert.throws(
      () =>
        db.transaction((outer) => {
          insert(outer, 'outer rollback');
          outer.transaction((inner) => insert(inner, 'nested rollback'));

          throw new Error('stop');
        }),
      /stop/
    );
    test.expect(values(db)).toStrictEqual(['nested']);
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
      test.assert.throws(
        () =>
          outer.transaction((inner) => {
            insert(inner, 'discarded');

            throw new Error('nested failure');
          }),
        /nested failure/
      );
      insert(outer, 'after');
    });
    test.expect(values(db)).toStrictEqual(['before', 'after']);
  } finally {
    db.close();
  }
}

async function rejectedAsyncCallbacks(path: string) {
  const db = await Db.open(path);

  try {
    initialize(db);
    let invoked = false;

    test.assert.throws(
      () =>
        db.transaction(async () => {
          invoked = true;
        }),
      TypeError
    );
    test.assert.strictEqual(invoked, false);

    // oxlint-disable-next-line unicorn/no-thenable -- Exercise rejection of thenable transaction callbacks.
    for (const thenable of [{ then() {} }, Object.assign(() => {}, { then() {} })]) {
      test.assert.throws(
        () =>
          db.transaction((tx) => {
            insert(tx, 'discarded');

            return thenable;
          }),
        TypeError
      );
    }

    test.expect(values(db)).toStrictEqual([]);
  } finally {
    db.close();
  }
}

function assertExpiredCommit(db: DbTransaction) {
  test.assert.throws(() => insert(db, 'late commit write'), /transaction scope has ended/);
}

function assertExpiredScope(db: DbTransaction) {
  test.assert.throws(() => insert(db, 'late write'), /transaction scope has ended/);
  test.assert.throws(() => db.transaction(() => {}), /transaction scope has ended/);
  test.assert.throws(
    () => db.exec("INSERT INTO transaction_test VALUES ('late raw write')"),
    /transaction scope has ended/
  );
}

test.stable(
  'opens a private WAL connection with foreign keys and a busy timeout, and persists across reopen',
  () => fixture(privateConnection)
);

test.stable('opens an in-memory database and closes the underlying connection', async () => {
  const db = await Db.open(':memory:');

  test.assert.strictEqual(db.orm.get(sql.raw('PRAGMA foreign_keys'))?.foreign_keys, 1n);
  db.close();
  test.assert.throws(() => db.exec('SELECT 1'), /closed/);
});

test.stable('existing database preflight initializes SQLite in a fresh process', () =>
  fixture(async (path) => {
    const db = await Db.open(path);

    try {
      db.orm
        .insert(projects)
        .values({ name: 'Retained project', created_at: 1n, updated_at: 1n })
        .run();
    } finally {
      db.close();
    }

    const child = test.spawnTestProcess(
      [
        process.execPath,
        Bun.fileURLToPath(new URL('./fixtures/validate-first.ts', import.meta.url)),
        path
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    );
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ]);

    test.assert.strictEqual(status, 0, stderr);
    test.expect(JSON.parse(stdout)).toStrictEqual([{ name: 'Retained project' }]);
  })
);

test.stable('nested commits return callback values and roll back with the outer transaction', () =>
  fixture(nestedCommits)
);

test.stable('a caught nested failure rolls back its savepoint and preserves outer writes', () =>
  fixture(caughtNestedFailure)
);

test.stable(
  'rejects native async callbacks before invocation and rolls back thenable callbacks',
  () => fixture(rejectedAsyncCallbacks)
);

async function expiredAsyncScopes() {
  const db = await Db.open(':memory:');

  try {
    initialize(db);
    let continuation!: Promise<void>;

    test.assert.throws(
      () =>
        db.transaction((tx) => {
          insert(tx, 'rolled back');
          continuation = Promise.resolve().then(() => assertExpiredScope(tx));

          return continuation;
        }),
      TypeError
    );
    await continuation;
    test.expect(values(db)).toStrictEqual([]);
    db.transaction((tx) => {
      continuation = Promise.resolve().then(() => assertExpiredCommit(tx));
      insert(tx, 'committed');
    });
    await continuation;
    test.expect(values(db)).toStrictEqual(['committed']);
  } finally {
    db.close();
  }
}

test.stable(
  'expired async scopes cannot use orm, raw SQL, or start transactions',
  expiredAsyncScopes
);

test.stable(
  'boolean columns retain true and false alongside bigint integers across transactions and reopen',
  () =>
    fixture(async (path) => {
      const db = await Db.open(path);

      try {
        db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES(1,'One',1,1);
        INSERT INTO material_generation_scopes(id,project_id,enabled,created_at,updated_at)
        VALUES('open',1,1,1,1),('closed',1,0,1,1),('retained',1,1,1,1)`);
        test.assert.strictEqual(
          db.orm
            .select()
            .from(material_generation_scopes)
            .where(eq(material_generation_scopes.id, 'open'))
            .get()?.enabled,
          true
        );
        test.assert.strictEqual(
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

          test.assert.strictEqual(row?.enabled, false);
          test.assert.strictEqual(row?.project_id, 1n);
        });
      } finally {
        db.close();
      }

      const reopened = await Db.open(path);

      try {
        const rows = reopened.orm.select().from(material_generation_scopes).all();

        test.assert.strictEqual(rows.length, 3);
        test.expect(Object.fromEntries(rows.map((row) => [row.id, row.enabled]))).toStrictEqual({
          open: false,
          closed: false,
          retained: true
        });
        test.assert.ok(rows.every((row) => row.project_id === 1n));
      } finally {
        reopened.close();
      }
    })
);

test.stable('transaction capabilities expire after commit', () =>
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
      test.assert.throws(
        () => escaped!.orm.run(sql`INSERT INTO transaction_test VALUES ('late')`),
        /transaction scope has ended/
      );
      test.assert.throws(
        () => escapedOrm!.run(sql`INSERT INTO transaction_test VALUES ('late')`),
        /transaction scope has ended/
      );
      test.assert.throws(() => escapedRun!(), /transaction scope has ended/);
      test.expect(values(db)).toStrictEqual(['scoped']);
    } finally {
      db.close();
    }
  })
);

test.stable('SQLite cannot load extensions from SQL after vector setup', async () => {
  const db = await Db.open(':memory:');

  try {
    test.assert.throws(() => db.orm.get(sql`SELECT load_extension('untrusted')`));
  } finally {
    db.close();
  }
});

test.stable('root access cannot replace a transaction capability', () =>
  fixture(async (path) => {
    const db = await Db.open(path);

    try {
      initialize(db);
      const root = db.orm;
      const writeRoot = () => root.run(sql`INSERT INTO transaction_test VALUES ('root')`);

      db.transaction((tx) => {
        test.assert.throws(writeRoot, /transaction capability/);
        tx.orm.run(sql`INSERT INTO transaction_test VALUES ('scoped')`);
      });
      test.expect(values(db)).toStrictEqual(['scoped']);
    } finally {
      db.close();
    }
  })
);

test.stable('ORM-level transactions cannot bypass database capabilities', async () => {
  const db = await Db.open(':memory:');
  let invoked = false;
  const bypass = (orm: Db['orm']) =>
    Reflect.apply(Reflect.get(orm, 'transaction'), orm, [
      () => {
        invoked = true;
      }
    ]);

  try {
    test.assert.throws(() => bypass(db.orm), /transaction capability/);
    db.transaction((tx) => {
      test.assert.throws(() => bypass(tx.orm), /transaction capability/);
    });
    test.assert.strictEqual(invoked, false);
  } finally {
    db.close();
  }
});

test.stable('CTE APIs and builders expire with their transaction capability', async () => {
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
    test.assert.throws(lateWrite, /transaction scope has ended/);
    test.assert.throws(lateQuery, /transaction scope has ended/);
    test
      .expect(db.orm.select({ name: projects.name }).from(projects).all())
      .toStrictEqual([{ name: 'scoped' }]);
  } finally {
    db.close();
  }
});

test.stable('captured root CTE APIs cannot execute inside a transaction', async () => {
  const db = await Db.open(':memory:');

  try {
    const outside = db.orm.with();

    db.transaction(() => {
      test.assert.throws(
        () =>
          outside.insert(projects).values({ name: 'root', created_at: 1n, updated_at: 1n }).run(),
        /transaction capability/
      );
    });
    test.expect(db.orm.select({ name: projects.name }).from(projects).all()).toStrictEqual([]);
  } finally {
    db.close();
  }
});
