import assert from 'node:assert/strict';

import { recordings } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer } from 'effect';

import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { Conversations } from './index.ts';

testStable(
  'new sessions reuse one empty draft across concurrent requests and collections',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.mergeAll(Projects.layer, Conversations.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const project = yield* (yield* Projects).createProject({ name: 'Drafts' });
          const first = yield* conversations.createUntitledSession({});
          const repeated = yield* Effect.all(
            Array.from({ length: 8 }, () => conversations.createUntitledSession({})),
            { concurrency: 'unbounded' }
          );

          assert.ok(repeated.every((session) => session.id === first.id));
          const scoped = yield* conversations.createUntitledSession({ project: project.id });

          assert.equal(scoped.id, first.id);
          assert.deepEqual(scoped.projectIds, [project.id]);
          assert.equal((yield* conversations.sessions({ limit: 100 })).items.length, 1);
          const global = yield* conversations.createUntitledSession({});

          assert.equal(global.id, first.id);
          assert.deepEqual(global.projectIds, []);
          yield* conversations.updateSessionSelection({
            sessionId: first.id,
            expectedRevision: 0n,
            targets: []
          });
          assert.equal((yield* conversations.createUntitledSession({})).id, first.id);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable('new sessions preserve captured work and explicitly named sessions', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.mergeAll(Conversations.layer, Settings.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const named = yield* conversations.createSession({ title: 'Planned study' });
        const first = yield* conversations.createUntitledSession({});

        assert.notEqual(first.id, named.id);
        yield* conversations.postMessage({ sessionId: first.id, text: 'My notes' });
        const second = yield* conversations.createUntitledSession({});

        assert.notEqual(second.id, first.id);
        yield* conversations.renameSession({ id: second.id, title: 'Next topic' });
        const third = yield* conversations.createUntitledSession({});

        assert.notEqual(third.id, second.id);
        assert.equal((yield* conversations.createUntitledSession({})).id, third.id);
        assert.equal(
          (yield* conversations.thread({ sessionId: first.id, limit: 100 })).items[0]?.versions.at(
            -1
          )?.text,
          'My notes'
        );
        assert.equal((yield* conversations.session(second.id)).title, 'Next topic');

        context.transaction(() => {
          context.db.orm
            .insert(recordings)
            .values({
              session_id: third.id,
              started_at: 1n,
              updated_at: 1n
            })
            .run();
        });
        const fourth = yield* conversations.createUntitledSession({});

        assert.notEqual(fourth.id, third.id);
        yield* conversations.captureSessionContext({
          sessionId: fourth.id,
          additionalSessionIds: [first.id],
          intentKey: 'draft-context',
          instruction: 'Keep this instruction',
          preferences: {}
        });
        const fifth = yield* conversations.createUntitledSession({});

        assert.notEqual(fifth.id, fourth.id);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable('first send atomically creates a visible session and first message', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.mergeAll(Conversations.layer, Settings.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const initialMessage = { text: 'First saved note' };
        const session = yield* conversations.createUntitledSession({ initialMessage });
        assert.deepEqual(
          (yield* conversations.sessions({ limit: 100 })).items.map((item) => item.id),
          [session.id]
        );
        const thread = yield* conversations.thread({ sessionId: session.id, limit: 100 });

        assert.equal(thread.items.length, 1);
        assert.equal(thread.items[0]?.versions.at(-1)?.text, 'First saved note');
        assert.equal(
          (yield* Effect.flip(
            conversations.createUntitledSession({
              initialMessage: { text: ' ' }
            })
          )).kind,
          'invalid_input'
        );
        assert.equal((yield* conversations.sessions({ limit: 100 })).items.length, 1);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
