import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectIdSchema } from '@study/contracts/ids';
import { createTestDatabase } from '@study/db/testing';
import { Clock, Effect } from 'effect';
import { Schema } from 'effect';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction, useStore } from '#server/platform/definitions/define-store';

import { ProjectsStore } from './index.ts';

test('custom subject icon persists across SQLite reopen and automatic mode restores title-derived identity', async () => {
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
      transaction((tx) => tx.store(ProjectsStore).setIcon({ id: created.id, icon: 'BIO' }))
    );
    context.close();
    context = new ServerContext(location.open(), clock);
    const store = await provide(useStore(ProjectsStore));
    assert.equal((await Effect.runPromise(store.project(created.id))).icon, 'BIO');
    await provide(
      transaction((tx) =>
        tx.store(ProjectsStore).renameProject({ id: created.id, name: 'Advanced Biology' })
      )
    );
    assert.equal((await Effect.runPromise(store.project(created.id))).icon, 'BIO');
    await provide(
      transaction((tx) => tx.store(ProjectsStore).setIcon({ id: created.id, icon: null }))
    );
    assert.equal((await Effect.runPromise(store.project(created.id))).icon, null);
    const error = await provide(
      Effect.flip(
        transaction((tx) =>
          tx.store(ProjectsStore).setIcon({
            id: Schema.decodeUnknownSync(projectIdSchema)(99999n),
            icon: 'BIO'
          })
        )
      )
    );
    assert.equal(error.kind, 'not_found');
  } finally {
    context.close();
    location.cleanup();
  }
});
