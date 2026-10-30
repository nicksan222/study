import { types } from 'node:util';

import { StudyError } from '@study/contracts/errors';
import { Db, sql } from '@study/db';
import type { Clock } from 'effect';

import { requireRow } from '#server/platform/database/rows';
import { liveClock } from '#server/platform/time/index';

/** One connection with synchronous transactions and committed refresh hints. */
export class ServerContext {
  private transactionDepth = 0;
  private readonly listeners = new Set<() => void>();
  readonly db: Db;
  readonly clock: Clock.Clock;

  constructor(db: Db, clock: Clock.Clock = liveClock()) {
    this.clock = clock;
    this.db = db;
    this.transaction(() => {});
  }

  static open(path: string, clock?: Clock.Clock): ServerContext {
    const db = Db.open(path);

    try {
      return new ServerContext(db, clock);
    } catch (error) {
      db.close();

      throw error;
    }
  }

  assertTransactionActive(): void {
    if (this.transactionDepth === 0)
      throw new StudyError('internal', 'An active server transaction is required');
  }

  transaction<T>(work: () => T): T {
    if (types.isAsyncFunction(work))
      throw new TypeError('transaction callback must be synchronous');

    const nested = this.transactionDepth > 0;
    const before = nested ? null : this.changes();
    const result = this.db.transaction(() => {
      this.transactionDepth++;

      try {
        const value = work();

        return value;
      } finally {
        this.transactionDepth--;
      }
    });

    // A caught inner rollback may produce an extra hint. Readers always requery SQLite.
    if (!nested && before !== this.changes()) {
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
