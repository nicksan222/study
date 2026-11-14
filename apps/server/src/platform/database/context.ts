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

import type { DependencyScope } from '@study/contracts/protocol';
import { Db, sql } from '@study/db';
import type { DbTransaction } from '@study/db';
import type { Clock } from 'effect';

import { requireRow } from '#server/platform/database/rows';
import { liveClock } from '#server/platform/time/index';

export interface RevisionSnapshot {
  readonly generation: string;
  readonly scopes: Readonly<Partial<Record<DependencyScope, bigint>>>;
}

/** One connection with synchronous transactions and committed refresh hints. */
export class ServerContext {
  private readonly tracking = { rolledBackChanges: 0n };
  private readonly listeners = new Set<() => void>();
  readonly transactionOwner = Symbol();
  readonly db: Db;
  readonly clock: Clock.Clock;
  readonly timestampClock: Clock.Clock;

  constructor(db: Db, clock: Clock.Clock = liveClock(), timestampClock: Clock.Clock = clock) {
    this.clock = clock;
    this.timestampClock = timestampClock;
    this.db = db;
    db.transaction((tx) => {
      tx.orm.run(sql`INSERT INTO reactive_generation (singleton, generation)
        VALUES (1, ${crypto.randomUUID()}) ON CONFLICT DO NOTHING`);
    });
  }

  static async open(
    path: string,
    clock?: Clock.Clock,
    timestampClock?: Clock.Clock
  ): Promise<ServerContext> {
    const db = await Db.open(path);

    try {
      return new ServerContext(db, clock, timestampClock);
    } catch (error) {
      db.close();

      throw error;
    }
  }

  transaction<T>(
    changes: readonly DependencyScope[],
    work: (context: ServerTransactionContext) => T
  ): T {
    const before = this.revisions();
    const result = this.db.transaction((db) => runTracked(this, db, changes, work, this.tracking));
    const after = this.revisions();

    if (!sameRevisions(before, after)) this.publishHint();

    return result;
  }

  /** A synchronous consistent read and its revisions share one SQLite snapshot. */
  snapshot<T>(work: (context: ServerTransactionContext) => T): {
    readonly value: T;
    readonly revisions: RevisionSnapshot;
  } {
    return this.db.transaction((db) => {
      const value = assertSynchronous(work(transactionContext(this, db, this.tracking)));

      return { value, revisions: readRevisions(db) };
    });
  }

  revisions(): RevisionSnapshot {
    return this.db.transaction(readRevisions);
  }

  /** Restore changes identity even if the restored counters equal previously observed values. */
  rotateRevisionGeneration(generation: string = crypto.randomUUID()): void {
    if (this.revisions().generation === generation) return;

    this.db.transaction((db) => {
      db.orm.run(
        sql`UPDATE reactive_generation SET generation = ${generation} WHERE singleton = 1`
      );
      db.orm.run(sql`DELETE FROM reactive_revisions WHERE revision > 0`);
    });
    this.publishHint();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    this.listeners.clear();
    this.db.close();
  }

  private publishHint(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Hints cannot undo committed state. */
      }
    }
  }
}

function readRevisions(db: DbTransaction): RevisionSnapshot {
  const generation = requireRow(
    db.orm.get<{ generation: string }>(
      sql`SELECT generation FROM reactive_generation WHERE singleton = 1`
    )
  ).generation;
  const rows = db.orm.all<{ scope: DependencyScope; revision: bigint }>(
    sql`SELECT scope, revision FROM reactive_revisions`
  );
  const scopes: Partial<Record<DependencyScope, bigint>> = {};

  for (const row of rows) scopes[row.scope] = row.revision;

  return { generation, scopes };
}

function sameRevisions(a: RevisionSnapshot, b: RevisionSnapshot): boolean {
  return (
    a.generation === b.generation &&
    Object.keys(a.scopes).length === Object.keys(b.scopes).length &&
    Object.entries(a.scopes).every(
      ([scope, revision]) => new Map(Object.entries(b.scopes)).get(scope) === revision
    )
  );
}

type TrackingState = { rolledBackChanges: bigint };

function assertSynchronous<T>(value: T): T {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  ) {
    if (value instanceof Promise) value.catch(() => {});

    throw new TypeError('transaction callback must be synchronous');
  }

  return value;
}

function totalChanges(db: DbTransaction): bigint {
  return requireRow(db.orm.get<{ n: bigint }>(sql`SELECT total_changes() AS n`)).n;
}

function runTracked<T>(
  owner: ServerContext,
  db: DbTransaction,
  changes: readonly DependencyScope[],
  work: (context: ServerTransactionContext) => T,
  tracking: TrackingState
): T {
  if (Object.prototype.toString.call(work) === '[object AsyncFunction]')
    throw new TypeError('transaction callback must be synchronous');

  const before = totalChanges(db);
  const ignoredBefore = tracking.rolledBackChanges;

  try {
    const result = assertSynchronous(work(transactionContext(owner, db, tracking)));

    // SQLite total_changes includes rolled-back savepoints. Exclude those writes before
    // deciding whether this successful enclosing transaction changed persistent state.
    if (totalChanges(db) - before > tracking.rolledBackChanges - ignoredBefore) {
      for (const scope of new Set(changes)) {
        db.orm.run(sql`INSERT INTO reactive_revisions (scope, revision) VALUES (${scope}, 1)
          ON CONFLICT (scope) DO UPDATE SET revision = revision + 1`);
      }
    }

    return result;
  } catch (error) {
    tracking.rolledBackChanges +=
      totalChanges(db) - before - (tracking.rolledBackChanges - ignoredBefore);

    throw error;
  }
}

/** Access to the same owner through an expiring transaction capability. */
export interface ServerTransactionContext {
  readonly transactionOwner: symbol;
  readonly db: DbTransaction;
  readonly clock: Clock.Clock;
  readonly timestampClock: Clock.Clock;
  assertTransactionActive(): void;
  transaction<T>(
    changes: readonly DependencyScope[],
    work: (context: ServerTransactionContext) => T
  ): T;
}

function transactionContext(
  owner: ServerContext,
  db: DbTransaction,
  tracking: TrackingState
): ServerTransactionContext {
  return {
    transactionOwner: owner.transactionOwner,
    db,
    clock: owner.clock,
    timestampClock: owner.timestampClock,
    assertTransactionActive: () => {
      void db.orm;
    },
    transaction: (changes, work) =>
      db.transaction((nested) => runTracked(owner, nested, changes, work, tracking))
  };
}
