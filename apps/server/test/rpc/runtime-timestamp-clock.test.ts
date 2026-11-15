/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies fixed store timestamps remain separate from live application scheduling.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks note and backup timestamps and advancing durable deadline eligibility.          │
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

testStable('App store timestamps remain fixed while the runtime clock advances', async () => {
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

              const note = yield* client['notes.createNote']({ title: 'Canonical timestamp' });
              const backup = yield* client['system.createBackup']({});

              expect(backup.createdAtMs).toBe(100_000);

              return note;
            })
          )
        );

        expect(note.createdAt).toBe(100n);
        expect(app.store.clock).toBe(Context.get(Context.empty(), Clock.Clock));
        const before = app.store.clock.currentTimeMillisUnsafe();

        await Effect.runPromise(Effect.sleep('25 millis'));
        expect(app.store.clock.currentTimeMillisUnsafe()).toBeGreaterThan(before);
        expect(timestampClock.currentTimeMillisUnsafe()).toBe(100_000);
      } finally {
        await server.close();
      }
    } finally {
      await app.close();
    }
  } finally {
    await database.cleanup();
  }
});
