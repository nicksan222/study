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

import { agentRunIdSchema } from '@study/contracts/ai/progress';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction, useStore } from '#server/platform/definitions/define-store';

import { UsageStore } from './usage-store.ts';

testStable(
  'usage persists across reopen, deduplicates calls and filters by provider and time',
  async () => {
    const location = await createTestDatabase();
    let context = new ServerContext(await location.open());
    const now = context.clock.currentTimeMillisUnsafe();
    const record = {
      id: 'one',
      runId: agentRunIdSchema.make('run'),
      agent: 'reply',
      provider: 'chatgpt',
      model: 'model',
      timestamp: now,
      input: 100,
      cacheRead: 80,
      cacheWrite: 0,
      output: 10,
      reasoning: 3,
      incomplete: false
    };
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
