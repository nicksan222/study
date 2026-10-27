import { AsyncLocalStorage } from 'node:async_hooks';
import { chmodSync, closeSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';

import { drizzle } from 'drizzle-orm/node-sqlite';
import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

/** Owns a SQLite connection and synchronous, nested Drizzle transactions. */
export class Db {
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
    this.database = drizzle({ client: sqlite });
  }

  static open(path: string): Db {
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
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url))
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
