import { sql } from '@study/db';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies durable dependency revisions share transaction commit and rollback        │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns typed revision observation and lifetime checks.                                   │
 * │ - Preserves failures, successful snapshots and subscriber resource ownership.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real temporary SQLite connections validate persisted revision observations and           │
 * │ generation changes.                                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';

import { ServerContext } from './context.ts';
import type { ServerTransactionContext } from './context.ts';

function nestedPreference(tx: ServerTransactionContext) {
  tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'nested', '1')`);
}

function rollbackNestedPreference(tx: ServerTransactionContext) {
  nestedPreference(tx);

  throw new Error('nested rollback');
}

test.stable(
  'durable revisions advance atomically and rollback preserves observations',
  async ({ databases }) => {
    const fixture = await databases();
    const context = new ServerContext(await fixture.open());

    try {
      const before = context.revisions();

      test
        .expect(() =>
          context.transaction(['settings'], (tx) => {
            tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'key', '1')`);

            throw new Error('rollback');
          })
        )
        .toThrow('rollback');
      test.expect(context.revisions()).toEqual(before);
      context.transaction(['settings'], (tx) => {
        tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'key', '1')`);
      });
      test.expect(context.revisions().scopes.settings).toBe((before.scopes.settings ?? 0n) + 1n);
      test.expect(context.revisions().generation).toBe(before.generation);
    } finally {
      context.close();
      await fixture.cleanup();
    }
  }
);

test.stable(
  'separate connections observe committed revisions without commit hints',
  async ({ databases }) => {
    const fixture = await databases();
    const first = new ServerContext(await fixture.open());
    const second = new ServerContext(await fixture.open());

    try {
      let hints = 0;
      const unsubscribe = first.subscribe(() => hints++);

      second.transaction(['settings'], (tx) =>
        tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'key', '1')`)
      );
      test.expect(hints).toBe(0);
      test.expect(first.revisions()).toEqual(second.revisions());
      test.expect(first.revisions().scopes.settings).toBe(1n);
      unsubscribe();
    } finally {
      first.close();
      second.close();
      await fixture.cleanup();
    }
  }
);

test.stable(
  'caught nested rollback advances no revisions and publishes no hints',
  async ({ databases }) => {
    const fixture = await databases();
    const context = new ServerContext(await fixture.open());

    try {
      let hints = 0;

      context.subscribe(() => hints++);
      const before = context.revisions();

      context.transaction(['notes'], (outer) => {
        test
          .expect(() => outer.transaction(['settings'], rollbackNestedPreference))
          .toThrow('nested rollback');
      });
      test.expect(context.revisions()).toEqual(before);
      test.expect(hints).toBe(0);
      test
        .expect(context.db.orm.all(sql`SELECT * FROM preferences WHERE scope = 'test'`))
        .toEqual([]);
      context.transaction(['notes'], (outer) => {
        outer.transaction(['settings'], (inner) => {
          inner.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'committed', '1')`);
        });
      });
      test.expect(context.revisions().scopes.settings).toBe(1n);
      test.expect(context.revisions().scopes.notes).toBe(1n);
      test.expect(hints).toBe(1);
    } finally {
      context.close();
      await fixture.cleanup();
    }
  }
);

test.stable(
  'consistent snapshots include their revision and generation rotation invalidates old counters',
  async ({ databases }) => {
    const fixture = await databases();
    const context = new ServerContext(await fixture.open());

    try {
      context.transaction(['settings'], (tx) =>
        tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'value', '1')`)
      );
      const snapshot = context.snapshot((tx) =>
        tx.db.orm.all<{ value: string }>(sql`SELECT value FROM preferences WHERE scope = 'test'`)
      );

      test.expect(snapshot.value).toEqual([{ value: '1' }]);
      test.expect(snapshot.revisions.scopes.settings).toBe(1n);
      context.rotateRevisionGeneration();
      test.expect(context.revisions().generation).not.toBe(snapshot.revisions.generation);
      test.expect(context.revisions().scopes).toEqual({});
    } finally {
      context.close();
      await fixture.cleanup();
    }
  }
);

test.stable(
  'outer rollback removes successful nested revision bumps and state together',
  async ({ databases }) => {
    const fixture = await databases();
    const context = new ServerContext(await fixture.open());

    try {
      const before = context.revisions();

      test
        .expect(() =>
          context.transaction(['notes'], (outer) => {
            outer.transaction(['settings'], nestedPreference);

            throw new Error('outer rollback');
          })
        )
        .toThrow('outer rollback');
      test.expect(context.revisions()).toEqual(before);
      context.transaction(['settings'], (tx) =>
        tx.db.orm.run(sql`INSERT INTO preferences VALUES ('test', 'next', '1')`)
      );
      test.expect(context.revisions().scopes.settings).toBe(1n);
    } finally {
      context.close();
      await fixture.cleanup();
    }
  }
);
