import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestDatabase } from '@study/db/testing';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';

import { ProjectsStore } from '#server/features/projects/store/index';
import { ServerContext } from '#server/platform/database/context';
import { transaction } from '#server/platform/definitions/define-store';

test('project timestamps use the captured native clock in SQLite transactions', async () => {
  const location = createTestDatabase();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(100_000);
        const clock = yield* Clock.Clock;
        const context = new ServerContext(location.open(), clock);

        try {
          const project = yield* transaction(context, (tx) =>
            tx.store(ProjectsStore).createProject({ name: 'First' })
          );

          assert.equal(project.createdAt, 100n);
          yield* TestClock.adjust('2 seconds');
          yield* transaction(context, (tx) =>
            tx.store(ProjectsStore).renameProject({ id: project.id, name: 'Second' })
          );
          const updated = yield* ProjectsStore.make(context).project(project.id);

          assert.equal(updated.updatedAt, 102n);
        } finally {
          context.close();
        }
      }).pipe(Effect.provide(TestClock.layer()))
    );
  } finally {
    location.cleanup();
  }
});

test('project stores retain their own SQLite context', async () => {
  const first = createTestDatabase();
  const second = createTestDatabase();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock;
        const left = new ServerContext(first.open(), clock);
        const right = new ServerContext(second.open(), clock);

        try {
          const leftStore = ProjectsStore.make(left);
          const rightStore = ProjectsStore.make(right);
          const created = yield* transaction(left, (tx) =>
            tx.store(ProjectsStore).createProject({ name: 'Left only' })
          );

          assert.equal((yield* leftStore.project(created.id)).name, 'Left only');
          assert.equal((yield* rightStore.projects({ limit: 10 })).length, 0);
        } finally {
          left.close();
          right.close();
        }
      })
    );
  } finally {
    first.cleanup();
    second.cleanup();
  }
});
