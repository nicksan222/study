import { Database } from 'bun:sqlite';

import { BunFileSystem } from '@effect/platform-bun';
import { CryptoHasher } from 'bun';
import { drizzle, bunSQLiteCodecs } from 'drizzle-orm/bun-sqlite';
import type { SQLiteBunDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Effect, FileSystem } from 'effect';
import { load as loadVectorExtension } from 'sqlite-vec';

import { configureSqliteRuntime } from './sqlite-runtime.ts';

type QueryOrm = Omit<SQLiteBunDatabase, 'transaction'>;

/** Owns a SQLite connection and synchronous, nested Drizzle transactions. */

export class Db {
  private static snapshotSchema: { sql: string; identity: string } | undefined;
  readonly path: string;
  private readonly sqlite: Database;
  private readonly database: SQLiteBunDatabase;
  private transactionActive = false;
  private closed = false;
  private readonly root: QueryOrm;

  private constructor(sqlite: Database, path: string) {
    loadVectorExtension(sqlite);
    this.sqlite = sqlite;
    this.path = path;
    this.database = drizzle({
      client: sqlite,
      codecs: {
        ...bunSQLiteCodecs,
        'integer:boolean': {
          ...bunSQLiteCodecs['integer:boolean'],
          // Database returns integer columns as bigint, including boolean storage.
          normalize: (value: unknown) => value === 1n || value === 1
        }
      }
    });
    this.root = guardTransaction(
      this.database,
      () => !this.transactionActive && !this.closed,
      'root database unavailable during transaction; use its transaction capability'
    );
  }

  static async open(
    path: string,
    migrationsFolder = Bun.fileURLToPath(new URL('../drizzle', import.meta.url))
  ): Promise<Db> {
    await configureSqliteRuntime();

    if (path !== ':memory:') {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;

            yield* fs.open(path, {
              flag: 'a',
              mode: 0o600,
              noFollow: process.platform !== 'win32'
            });

            if (process.platform !== 'win32') yield* fs.chmod(path, 0o600);
          })
        ).pipe(Effect.provide(BunFileSystem.layer))
      );
    }

    const sqlite = new Database(path, { safeIntegers: true });

    try {
      // SQLite table rebuilds must disable foreign keys before the migrator's transaction.
      sqlite.exec('PRAGMA busy_timeout = 30000; PRAGMA foreign_keys = OFF;');
      migrate(drizzle({ client: sqlite }), {
        migrationsFolder
      });
      sqlite.exec(
        'PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON; PRAGMA journal_mode = WAL;'
      );

      return new Db(sqlite, path);
    } catch (error) {
      sqlite.close(true);

      throw error;
    }
  }

  /** Flush an exclusively owned file before replacement, without running migrations. */
  static async checkpointFile(path: string): Promise<void> {
    await configureSqliteRuntime();

    const sqlite = new Database(path, { safeIntegers: true });

    try {
      const result = sqlite.query<{ busy: bigint }, []>('PRAGMA wal_checkpoint(TRUNCATE)').get();

      if (result?.busy !== 0n) throw new Error('Database checkpoint is busy');
    } finally {
      sqlite.close(true);
    }
  }

  /** SQLite's online backup includes committed WAL pages in one consistent snapshot. */
  snapshot(path: string, maximumBytes?: number): Promise<number> {
    this.assertActive();

    const pageSize = Number(
      this.sqlite.query<{ page_size: bigint }, []>('PRAGMA page_size').get()!.page_size
    );

    const checkSize = (pages: number) => {
      if (maximumBytes !== undefined && pages * pageSize > maximumBytes)
        throw new RangeError('Snapshot exceeds size bound');
    };

    checkSize(
      Number(this.sqlite.query<{ page_count: bigint }, []>('PRAGMA page_count').get()!.page_count)
    );

    // Reserve writers while checking size and serializing so the allocation cannot outgrow its bound.
    this.sqlite.exec('BEGIN IMMEDIATE');
    let bytes: Uint8Array;

    try {
      checkSize(
        Number(this.sqlite.query<{ page_count: bigint }, []>('PRAGMA page_count').get()!.page_count)
      );
      bytes = this.sqlite.serialize();
      checkSize(Math.ceil(bytes.byteLength / pageSize));
      this.sqlite.exec('COMMIT');
    } catch (error) {
      this.sqlite.exec('ROLLBACK');

      throw error;
    }

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const temporary = `${path}.${crypto.randomUUID()}.partial`;

          return yield* Effect.ensuring(
            Effect.gen(function* () {
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const file = yield* fs.open(temporary, { flag: 'wx', mode: 0o600 });

                  yield* file.writeAll(bytes);
                  yield* file.sync;
                })
              );
              yield* fs.rename(temporary, path);

              return bytes.byteLength / pageSize;
            }),
            fs.remove(temporary, { force: true }).pipe(Effect.ignore)
          );
        })
      ).pipe(Effect.provide(BunFileSystem.layer))
    );
  }

  /** Stable logical fingerprint, independent of WAL/checkpoint and backup header counters. */
  contentIdentity(): string {
    return this.transaction((tx) => tx.contentIdentity());
  }

  private readContentIdentity(): string {
    const hash = new CryptoHasher('sha256').update(this.schemaIdentity());

    const tables = this.sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_schema WHERE type='table' AND (name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') ORDER BY name"
      )
      .all();

    for (const table of tables) {
      const name = String(table.name);

      hash.update(name);
      // Identifiers originate in the already-supported schema, never an operation input.

      for (const row of this.sqlite
        .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
        .iterate())
        hash.update(
          JSON.stringify(row, (_, value) =>
            typeof value === 'bigint'
              ? { integer: value.toString() }
              : value instanceof Uint8Array
                ? { blob: Buffer.from(value).toString('base64') }
                : value
          )
        );
    }

    return hash.digest('hex');
  }

  /** Exact migrator-owned schema identity, including migration receipts and trigger SQL. */
  schemaIdentity(): string {
    const schema = this.schemaSqlIdentity();

    const migrations = this.sqlite
      .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at,hash')
      .all();

    return new CryptoHasher('sha256')
      .update(
        JSON.stringify({ schema, migrations }, (_, value) =>
          typeof value === 'bigint' ? value.toString() : value
        )
      )
      .digest('hex');
  }

  private schemaSqlIdentity(): string {
    return JSON.stringify(
      this.sqlite
        .prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')
        .all()
    );
  }

  /** Migrations are fixed for this process; retain only trusted fingerprints, never a connection. */
  private static async supportedSnapshotSchema() {
    if (Db.snapshotSchema) return Db.snapshotSchema;

    const reference = await Db.open(':memory:');

    try {
      Db.snapshotSchema = {
        sql: reference.schemaSqlIdentity(),
        identity: reference.schemaIdentity()
      };

      return Db.snapshotSchema;
    } finally {
      reference.close();
    }
  }

  /** Validate untrusted schema before running integrity checks or opening it for writes. */
  static async validateSnapshot(path: string): Promise<string> {
    await configureSqliteRuntime();

    const sqlite = new Database(path, {
      readonly: true,
      safeIntegers: true
    });

    const candidate = new Db(sqlite, path);

    try {
      const reference = await Db.supportedSnapshotSchema();

      sqlite.exec('PRAGMA trusted_schema = OFF;');

      if (candidate.schemaSqlIdentity() !== reference.sql)
        throw new TypeError('Unsupported snapshot schema');

      const expected = reference.identity;

      if (candidate.schemaIdentity() !== expected)
        throw new TypeError('Unsupported snapshot schema');

      sqlite.exec('PRAGMA trusted_schema = ON; PRAGMA foreign_keys = ON;');

      const integrity = sqlite
        .query<{ integrity_check: string }, []>('PRAGMA integrity_check')
        .all();

      if (
        integrity.length !== 1 ||
        integrity[0]?.integrity_check !== 'ok' ||
        sqlite.prepare('PRAGMA foreign_key_check').all().length
      )
        throw new TypeError('Invalid snapshot integrity');

      return expected;
    } finally {
      sqlite.close(true);
    }
  }

  /** Open only after a caller has compared the untrusted file's schema to the supported schema. */
  static async openSnapshot(path: string): Promise<Db> {
    await Db.validateSnapshot(path);

    const sqlite = new Database(path, { safeIntegers: true });

    sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;');

    return new Db(sqlite, path);
  }

  get orm(): QueryOrm {
    this.assertActive();

    return this.root;
  }

  transaction<T>(work: (tx: DbTransaction) => T): T {
    this.assertActive();

    if (isAsyncFunction(work)) throw new TypeError('transaction callback must be synchronous');

    this.transactionActive = true;

    try {
      let result!: T;

      this.database.transaction(
        (tx) => {
          result = runTransaction(tx, this.sqlite, () => this.readContentIdentity(), work);
        },
        { behavior: 'immediate' }
      );

      return result;
    } finally {
      this.transactionActive = false;
    }
  }

  /** Executes connection-local SQL outside a transaction. */
  exec(statement: string): void {
    this.assertActive();
    this.sqlite.exec(statement);
  }

  close(): void {
    this.assertActive();
    // Strict close prevents outstanding statements from silently retaining connection locks.
    this.sqlite.close(true);
    this.closed = true;
  }

  private assertActive(): void {
    if (this.closed) throw new Error('Database has closed');

    if (this.transactionActive)
      throw new Error(
        'root database unavailable during transaction; use its transaction capability'
      );
  }
}

/** A transaction-scoped database capability, invalid after its callback returns. */
export interface DbTransaction {
  readonly orm: QueryOrm;
  exec(statement: string): void;
  contentIdentity(): string;
  transaction<T>(work: (tx: DbTransaction) => T): T;
}

// Plain rows outlive their query; method-bearing objects retain execution authority.
function isQueryResult(value: object): boolean {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return true;

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) return false;

  return Object.values(value).every((member) => typeof member !== 'function');
}

function guardTransaction<T extends object>(
  value: T,
  active: () => boolean,
  message = 'transaction scope has ended'
): T {
  const wrapped = new WeakMap<object, object>();
  const guard = (item: unknown): unknown => {
    if ((typeof item !== 'object' || item === null) && typeof item !== 'function') return item;

    if (isQueryResult(item)) return item;

    const object = item as object;
    const existing = wrapped.get(object);

    if (existing) return existing;

    const proxy = new Proxy(object, {
      get(target, key) {
        if (!active()) throw new Error(message);

        if (key === 'transaction') throw new TypeError('Use the database transaction capability');

        const member = Reflect.get(target, key, target);

        if (typeof member === 'function')
          return (...args: unknown[]) => {
            if (!active()) throw new Error(message);

            return guard(Reflect.apply(member, target, args));
          };

        return guard(member);
      }
    });

    wrapped.set(object, proxy);

    return proxy;
  };

  return guard(value) as T;
}

function isAsyncFunction(work: Function): boolean {
  return Object.prototype.toString.call(work) === '[object AsyncFunction]';
}

function runTransaction<T>(
  orm: SQLiteBunDatabase,
  sqlite: Database,
  identity: () => string,
  work: (tx: DbTransaction) => T
): T {
  if (isAsyncFunction(work)) throw new TypeError('transaction callback must be synchronous');

  let active = true;
  const guarded = guardTransaction(orm, () => active);
  const view: DbTransaction = {
    get orm() {
      if (!active) throw new Error('transaction scope has ended');

      return guarded;
    },
    exec: (statement) => {
      if (!active) throw new Error('transaction scope has ended');

      sqlite.exec(statement);
    },
    contentIdentity: () => {
      if (!active) throw new Error('transaction scope has ended');

      return identity();
    },
    transaction: <A>(nested: (tx: DbTransaction) => A): A => {
      if (!active) throw new Error('transaction scope has ended');

      if (isAsyncFunction(nested)) throw new TypeError('transaction callback must be synchronous');

      let result!: A;

      orm.transaction((tx) => {
        result = runTransaction(tx, sqlite, identity, nested);
      });

      return result;
    }
  };

  try {
    const value = work(view);

    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof (value as { then?: unknown }).then === 'function'
    ) {
      if (value instanceof Promise) value.catch(() => {});

      throw new TypeError('transaction callback must be synchronous');
    }

    return value;
  } finally {
    active = false;
  }
}
