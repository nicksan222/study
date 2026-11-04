import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, openSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';

import { drizzle, nodeSQLiteCodecs } from 'drizzle-orm/node-sqlite';
import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

/** Owns a SQLite connection and synchronous, nested Drizzle transactions. */

export class Db {
  private static snapshotSchema: { sql: string; identity: string } | undefined;
  readonly path: string;
  private readonly sqlite: DatabaseSync;
  private readonly database: NodeSQLiteDatabase;
  private activeTransaction: NodeSQLiteDatabase | undefined;
  private readonly transactionContext = new AsyncLocalStorage<{
    active: boolean;
  }>();

  private constructor(sqlite: DatabaseSync, path: string) {
    this.sqlite = sqlite;
    this.path = path;
    this.database = drizzle({
      client: sqlite,
      codecs: {
        ...nodeSQLiteCodecs,
        'integer:boolean': {
          ...nodeSQLiteCodecs['integer:boolean'],
          // DatabaseSync returns integer columns as bigint, including boolean storage.
          normalize: (value: unknown) => value === 1n || value === 1
        }
      }
    });
  }

  static open(
    path: string,
    migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))
  ): Db {
    if (process.platform !== 'win32' && path !== ':memory:') {
      const fd = openSync(path, 'a', 0o600);

      closeSync(fd);
      chmodSync(path, 0o600);
    }

    const sqlite = new DatabaseSync(path, { readBigInts: true });

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
      sqlite.close();

      throw error;
    }
  }

  /** SQLite's online backup includes committed WAL pages in one consistent snapshot. */
  snapshot(path: string, maximumBytes?: number): Promise<number> {
    this.assertActive();

    const pageSize = Number(this.sqlite.prepare('PRAGMA page_size').get()!.page_size);

    const checkSize = (pages: number) => {
      if (maximumBytes !== undefined && pages * pageSize > maximumBytes)
        throw new RangeError('Snapshot exceeds size bound');
    };

    checkSize(Number(this.sqlite.prepare('PRAGMA page_count').get()!.page_count));

    return backup(this.sqlite, path, { progress: ({ totalPages }) => checkSize(totalPages) });
  }

  /** Stable logical fingerprint, independent of WAL/checkpoint and backup header counters. */
  contentIdentity(): string {
    return this.transaction(() => {
      const hash = createHash('sha256').update(this.schemaIdentity());

      const tables = this.sqlite
        .prepare(
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
    });
  }

  /** Exact migrator-owned schema identity, including migration receipts and trigger SQL. */
  schemaIdentity(): string {
    const schema = this.schemaSqlIdentity();

    const migrations = this.sqlite
      .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at,hash')
      .all();

    return createHash('sha256')
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
  private static supportedSnapshotSchema() {
    if (Db.snapshotSchema) return Db.snapshotSchema;

    const reference = Db.open(':memory:');

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
  static validateSnapshot(path: string): string {
    const sqlite = new DatabaseSync(path, { readOnly: true, readBigInts: true });

    const candidate = new Db(sqlite, path);

    try {
      const reference = Db.supportedSnapshotSchema();

      sqlite.exec('PRAGMA trusted_schema = OFF;');

      if (candidate.schemaSqlIdentity() !== reference.sql)
        throw new TypeError('Unsupported snapshot schema');

      const expected = reference.identity;

      if (candidate.schemaIdentity() !== expected)
        throw new TypeError('Unsupported snapshot schema');

      sqlite.exec('PRAGMA trusted_schema = ON; PRAGMA foreign_keys = ON;');

      const integrity = sqlite.prepare('PRAGMA integrity_check').all();

      if (
        integrity.length !== 1 ||
        integrity[0]?.integrity_check !== 'ok' ||
        sqlite.prepare('PRAGMA foreign_key_check').all().length
      )
        throw new TypeError('Invalid snapshot integrity');

      return expected;
    } finally {
      sqlite.close();
    }
  }

  /** Open only after a caller has compared the untrusted file's schema to the supported schema. */
  static openSnapshot(path: string): Db {
    Db.validateSnapshot(path);

    const sqlite = new DatabaseSync(path, { readBigInts: true });

    sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;');

    return new Db(sqlite, path);
  }

  get orm(): NodeSQLiteDatabase {
    this.assertActive();

    return this.activeTransaction ?? this.database;
  }

  transaction<T>(work: () => T): T {
    this.assertActive();

    if (types.isAsyncFunction(work))
      throw new TypeError('transaction callback must be synchronous');

    const previous = this.activeTransaction;

    const context = { active: true };

    let result!: T;

    this.orm.transaction(
      (tx) => {
        this.activeTransaction = tx;

        try {
          const value = this.transactionContext.run(context, work);

          if (
            value !== null &&
            (typeof value === 'object' || typeof value === 'function') &&
            typeof (value as { then?: unknown }).then === 'function'
          ) {
            if (value instanceof Promise) value.catch(() => {});

            throw new TypeError('transaction callback must be synchronous');
          }

          result = value;
        } finally {
          context.active = false;
          this.activeTransaction = previous;
        }
      },
      { behavior: 'immediate' }
    );

    return result;
  }

  /** Executes connection-local SQL while respecting the active transaction scope. */
  exec(statement: string): void {
    this.assertActive();
    this.sqlite.exec(statement);
  }

  close(): void {
    this.assertActive();
    this.sqlite.close();
  }

  private assertActive(): void {
    const context = this.transactionContext.getStore();

    if (context && !context.active) throw new Error('transaction scope has ended');
  }
}
