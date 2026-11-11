/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks that project timestamps come from the transaction’s captured clock and      │
 * │ remain isolated per database context.                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises project timestamps use the captured native clock in SQLite transactions.     │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { assert } from 'vite-plus/test';

import { ProjectsStore } from '#server/features/projects/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction, useStore } from '#server/platform/definitions/define-store';

testStable('project timestamps use the captured native clock in SQLite transactions', async () => {
  const location = await createTestDatabase();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(100_000);
        const clock = yield* Clock.Clock;
        const context = new ServerContext(yield* Effect.promise(() => location.open()), clock);

        try {
          const project = yield* transaction((tx) =>
            tx.store(ProjectsStore).createProject({ name: 'First' })
          ).pipe(Effect.provideService(Database, { store: context }));

          assert.strictEqual(project.createdAt, 100n);
          yield* TestClock.adjust('2 seconds');
          yield* transaction((tx) =>
            tx.store(ProjectsStore).renameProject({ id: project.id, name: 'Second' })
          ).pipe(Effect.provideService(Database, { store: context }));
          const updated = yield* Effect.runSync(
            useStore(ProjectsStore).pipe(Effect.provideService(Database, { store: context }))
          ).project(project.id);

          assert.strictEqual(updated.updatedAt, 102n);
        } finally {
          context.close();
        }
      }).pipe(Effect.provide(TestClock.layer()))
    );
  } finally {
    await location.cleanup();
  }
});

testStable('project stores retain their own SQLite context', async () => {
  const first = await createTestDatabase();
  const second = await createTestDatabase();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock;
        const left = new ServerContext(yield* Effect.promise(() => first.open()), clock);
        const right = new ServerContext(yield* Effect.promise(() => second.open()), clock);

        try {
          const leftStore = Effect.runSync(
            useStore(ProjectsStore).pipe(Effect.provideService(Database, { store: left }))
          );
          const rightStore = Effect.runSync(
            useStore(ProjectsStore).pipe(Effect.provideService(Database, { store: right }))
          );
          const created = yield* transaction((tx) =>
            tx.store(ProjectsStore).createProject({ name: 'Left only' })
          ).pipe(Effect.provideService(Database, { store: left }));

          assert.ok((yield* leftStore.project(created.id)).name === 'Left only');
          assert.strictEqual((yield* rightStore.projects({ limit: 10 })).length, 0);
        } finally {
          left.close();
          right.close();
        }
      })
    );
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});
