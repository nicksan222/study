import { agentRunIdSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies durable usage accounting against a real temporary SQLite database.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks deduplication, persistence, provider filtering and reporting time bounds.       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests own their SQLite connection and remove only isolated temporary data.               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction, useStore } from '#server/platform/definitions/define-store';

import { UsageStore } from './usage-store.ts';

function usageRecord(timestamp: number) {
  return {
    id: 'one',
    runId: agentRunIdSchema.make('run'),
    agent: 'reply',
    provider: 'chatgpt',
    model: 'model',
    timestamp,
    input: 100,
    cacheRead: 80,
    cacheWrite: 0,
    output: 10,
    reasoning: 3,
    incomplete: false
  };
}

test.server.stable(
  'usage reporting shares ledger time while operational time advances independently',
  async ({ databases, expect }) => {
    const location = await databases();
    const now = Date.parse('2026-11-13T11:00:00.000Z');
    const timestampClock = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(now);

        return yield* Clock.Clock;
      }).pipe(Effect.provide(TestClock.layer()))
    );
    const db = await location.open();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* TestClock.setTime(now + 10 * 86400000);
          const clock = yield* Clock.Clock;
          const context = new ServerContext(db, clock, timestampClock);

          yield* transaction((tx) =>
            tx.store(UsageStore).record(usageRecord(timestampClock.currentTimeMillisUnsafe()))
          ).pipe(Effect.provideService(Database, { store: context }));
          const usage = yield* useStore(UsageStore).pipe(
            Effect.provideService(Database, { store: context })
          );
          const report = yield* usage.usageReport({ days: 7 });

          expect(report.generatedAt).toBe(now);
          expect(report.totals.requests).toBe(1);
          expect(report.days).toMatchObject([{ key: '2026-11-13', requests: 1 }]);
          yield* TestClock.adjust('90 days');
          expect(clock.currentTimeMillisUnsafe()).toBe(now + 100 * 86400000);
          expect(yield* usage.usageReport({ days: 7 })).toEqual(report);
        }).pipe(Effect.provide(TestClock.layer()))
      );
    } finally {
      db.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'usage persists across reopen, deduplicates calls and filters by provider and time',
  async ({ databases, expect }) => {
    const location = await databases();
    let context = new ServerContext(await location.open());
    const now = context.clock.currentTimeMillisUnsafe();
    const record = usageRecord(now);
    const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromise(effect.pipe(Effect.provideService(Database, { store: context })));

    try {
      await run(
        transaction((tx) => {
          const store = tx.store(UsageStore);

          store.record(record);
          store.record(record);
          store.record({ ...record, id: 'two', provider: 'future-provider', incomplete: true });
          store.record({ ...record, id: 'old', timestamp: now - 100 * 86400000 });
          store.record({ ...record, id: 'future', timestamp: now + 86400000 });
        })
      );
      context.close();
      context = new ServerContext(await location.open());
      const store = await run(useStore(UsageStore));
      const report = await Effect.runPromise(store.usageReport({ days: 7 }));

      expect(report.totals).toEqual({
        input: 200,
        cacheRead: 160,
        cacheWrite: 0,
        output: 20,
        reasoning: 6,
        requests: 2,
        runs: 1,
        incomplete: 1
      });
      expect(report.providers).toEqual(['chatgpt', 'future-provider']);
      expect(report.models).toHaveLength(2);
      expect(report.agents).toHaveLength(2);
      expect(report.days).toHaveLength(1);
      expect(
        (await Effect.runPromise(store.usageReport({ days: 1, provider: 'future-provider' })))
          .totals.requests
      ).toBe(1);
      expect(
        (await Effect.runPromise(store.usageReport({ days: 1, provider: 'missing' }))).totals
          .requests
      ).toBe(0);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
