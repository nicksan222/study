import { StudyRpc } from '@study/contracts';
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
import { makeStudyClient } from '@study/server/client';
import { serve } from '@study/server/runtime';
import { test } from '@study/testing';
import { Clock, Context, Effect } from 'effect';
import { TestClock } from 'effect/testing';

test.stable(
  'App store timestamps remain fixed while the runtime clock advances',
  async ({ resources: database }) => {
    const timestampClock = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(100_000);

        return yield* Clock.Clock;
      }).pipe(Effect.provide(TestClock.layer()))
    );

    try {
      const app = await database.openApp({ path: database.path, timestampClock });

      try {
        const server = await serve(app);

        try {
          const note = await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

                const note = yield* client['notes.createNote']({ title: 'Canonical timestamp' });
                const backup = yield* client['system.createBackup']({});

                test.expect(backup.createdAtMs).toBe(100_000);

                return note;
              })
            )
          );

          test.expect(note.createdAt).toBe(100n);
          test.expect(app.store.clock).toBe(Context.get(Context.empty(), Clock.Clock));
          const before = app.store.clock.currentTimeMillisUnsafe();

          await Effect.runPromise(Effect.sleep('25 millis'));
          test.expect(app.store.clock.currentTimeMillisUnsafe()).toBeGreaterThan(before);
          test.expect(timestampClock.currentTimeMillisUnsafe()).toBe(100_000);
        } finally {
          await server.close();
        }
      } finally {
        await app.close();
      }
    } finally {
      await database.close();
    }
  }
);
