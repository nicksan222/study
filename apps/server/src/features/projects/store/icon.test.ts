/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises structured project icons across SQLite reopen and missing-subject        │
 * │ failures.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies persisted glyph modes and theme accent choices.                               │
 * │ - Checks automatic initials survive canonical subject mutations.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the project store and real database without replacing the persistence boundary.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { projectIdSchema } from '@study/contracts/ids';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Clock, Effect } from 'effect';
import { Schema } from 'effect';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction, useStore } from '#server/platform/definitions/define-store';

import { ProjectsStore } from './index.ts';

testStable(
  'custom subject icon persists across SQLite reopen and automatic mode restores title-derived identity',
  async () => {
    const location = createTestDatabase();
    const clock = Effect.runSync(Clock.Clock);
    let context = new ServerContext(location.open(), clock);
    const provide = <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromise(effect.pipe(Effect.provideService(Database, { store: context })));

    try {
      const created = await provide(
        transaction((tx) => tx.store(ProjectsStore).createProject({ name: 'Cell Biology' }))
      );

      await provide(
        transaction((tx) =>
          tx
            .store(ProjectsStore)
            .setIcon({ id: created.id, icon: { kind: 'monogram', value: 'BIO', color: 'neutral' } })
        )
      );
      context.close();
      context = new ServerContext(location.open(), clock);
      const store = await provide(useStore(ProjectsStore));

      assert.deepEqual((await Effect.runPromise(store.project(created.id))).icon, {
        kind: 'monogram',
        value: 'BIO',
        color: 'neutral'
      });
      await provide(
        transaction((tx) =>
          tx.store(ProjectsStore).renameProject({ id: created.id, name: 'Advanced Biology' })
        )
      );
      assert.deepEqual((await Effect.runPromise(store.project(created.id))).icon, {
        kind: 'monogram',
        value: 'BIO',
        color: 'neutral'
      });
      await provide(
        transaction((tx) =>
          tx
            .store(ProjectsStore)
            .setIcon({ id: created.id, icon: { kind: 'automatic', color: 'neutral' } })
        )
      );
      assert.deepEqual((await Effect.runPromise(store.project(created.id))).icon, {
        kind: 'automatic',
        color: 'neutral'
      });
      const error = await provide(
        Effect.flip(
          transaction((tx) =>
            tx.store(ProjectsStore).setIcon({
              id: Schema.decodeUnknownSync(projectIdSchema)(99999n),
              icon: { kind: 'monogram', value: 'BIO', color: 'neutral' }
            })
          )
        )
      );

      assert.deepEqual(error.kind, 'not_found');
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable('rich icons persist their typed variant and color across SQLite reopen', async () => {
  const location = createTestDatabase();
  const clock = Effect.runSync(Clock.Clock);
  let context = new ServerContext(location.open(), clock);
  const provide = <A, E>(effect: Effect.Effect<A, E, Database>) =>
    Effect.runPromise(effect.pipe(Effect.provideService(Database, { store: context })));

  try {
    const created = await provide(
      transaction((tx) => tx.store(ProjectsStore).createProject({ name: 'Biology' }))
    );

    for (const icon of [
      { kind: 'symbol', value: 'atom', color: 'violet' },
      { kind: 'emoji', value: '📚', color: 'blue' },
      { kind: 'automatic', color: 'green' }
    ] as const) {
      await provide(transaction((tx) => tx.store(ProjectsStore).setIcon({ id: created.id, icon })));
      context.close();
      context = new ServerContext(location.open(), clock);
      const store = await provide(useStore(ProjectsStore));

      assert.deepEqual((await Effect.runPromise(store.project(created.id))).icon, icon);
    }
  } finally {
    context.close();
    location.cleanup();
  }
});
