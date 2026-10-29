import { types } from 'node:util';

import { Db } from '@study/db';
import { sql } from 'drizzle-orm';

import { reconcileJobs } from '#server/procedures/jobs/worker';

/** One connection with synchronous transactions and committed refresh hints. */
export class ServerContext {
  private transactionDepth = 0;
  private readonly listeners = new Set<() => void>();
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    this.transaction(() => {});
  }

  static open(path: string): ServerContext {
    const db = Db.open(path);

    try {
      return new ServerContext(db);
    } catch (error) {
      db.close();

      throw error;
    }
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

        if (!nested) reconcileJobs(this);

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
    return this.db.orm.get<{ n: bigint }>(sql`SELECT total_changes() AS n`)!.n;
  }
}
