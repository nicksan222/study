/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Owns one SQLite connection, synchronous transactions, and post-commit change hints │
 * │ for server services. Subscribers are notified only after successful outer transactions   │
 * │ and must reread persisted state.                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports ServerContext. Subscribers are notified only after successful outer            │
 * │   transactions and must reread persisted state.                                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Db owns the SQLite connection; ServerContext owns synchronous transaction nesting and    │
 * │ emits hints only after outer commits.                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Db, sql } from '@study/db';
import type { DbTransaction } from '@study/db';
import type { Clock } from 'effect';

import { requireRow } from '#server/platform/database/rows';
import { liveClock } from '#server/platform/time/index';

/** One connection with synchronous transactions and committed refresh hints. */
export class ServerContext {
  private readonly listeners = new Set<() => void>();
  readonly transactionOwner = Symbol();
  readonly db: Db;
  readonly clock: Clock.Clock;

  constructor(db: Db, clock: Clock.Clock = liveClock()) {
    this.clock = clock;
    this.db = db;
    this.transaction(() => {});
  }

  static async open(path: string, clock?: Clock.Clock): Promise<ServerContext> {
    const db = await Db.open(path);

    try {
      return new ServerContext(db, clock);
    } catch (error) {
      db.close();

      throw error;
    }
  }

  transaction<T>(work: (context: ServerTransactionContext) => T): T {
    if (Object.prototype.toString.call(work) === '[object AsyncFunction]')
      throw new TypeError('transaction callback must be synchronous');

    const before = this.changes();
    const result = this.db.transaction((db) => work(transactionContext(this, db)));

    if (before !== this.changes()) {
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          /* Refresh hints must not undo a commit. */
        }
      }
    }

    return result;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.db.close();
  }

  private changes(): bigint {
    return requireRow(this.db.orm.get<{ n: bigint }>(sql`SELECT total_changes() AS n`)).n;
  }
}

/** Access to the same owner through an expiring transaction capability. */
export interface ServerTransactionContext {
  readonly transactionOwner: symbol;
  readonly db: DbTransaction;
  readonly clock: Clock.Clock;
  assertTransactionActive(): void;
  transaction<T>(work: (context: ServerTransactionContext) => T): T;
}

function transactionContext(owner: ServerContext, db: DbTransaction): ServerTransactionContext {
  return {
    transactionOwner: owner.transactionOwner,
    db,
    clock: owner.clock,
    assertTransactionActive: () => {
      void db.orm;
    },
    transaction: (work) => db.transaction((nested) => work(transactionContext(owner, nested)))
  };
}
