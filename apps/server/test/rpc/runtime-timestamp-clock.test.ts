/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies fixed store timestamps remain separate from live application scheduling.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks committed note timestamps and advancing durable deadline eligibility.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the application composition boundary and real SQLite without browser capture.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts/rpc';
import { createTestDatabase } from '@study/db/testing';
import { makeStudyClient } from '@study/server/client';
import { App, serve } from '@study/server/runtime';
import { testStable } from '@study/testing/vitest';
import { Clock, Context, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { expect } from 'vite-plus/test';

import { workflowStore } from '#server/platform/workflows/store';

testStable(
  'App store timestamps can be fixed while durable deadlines and leases advance',
  async () => {
    const timestampClock = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(100_000);

        return yield* Clock.Clock;
      }).pipe(Effect.provide(TestClock.layer()))
    );
    const database = await createTestDatabase();

    try {
      const app = await App.open({ path: await database.prepare(), timestampClock });

      try {
        const server = await serve(app);

        try {
          const note = await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

                return yield* client['notes.createNote']({ title: 'Canonical timestamp' });
              })
            )
          );

          expect(note.createdAt).toBe(100n);
          expect(app.store.clock).toBe(Context.get(Context.empty(), Clock.Clock));
          const workflows = workflowStore(app.store);

          workflows.start('canonical-clock', 'test', '{}', undefined);
          expect(workflows.claim('canonical-clock', 'owner')).toBe(true);
          const deadline = BigInt(app.store.clock.currentTimeMillisUnsafe() + 500);

          workflows.clock('canonical-clock', 'wake', 'deferred', deadline, 'owner');
          expect(workflows.dueClocks(['test'])).toHaveLength(0);
          await Effect.runPromise(Effect.sleep('550 millis'));
          expect(workflows.dueClocks(['test'])).toHaveLength(1);
          expect(workflows.claim('canonical-clock', 'other')).toBe(false);
        } finally {
          await server.close();
        }
      } finally {
        await app.close();
      }
    } finally {
      await database.cleanup();
    }
  }
);
