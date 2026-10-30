import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Deferred, Effect, Fiber, Stream } from 'effect';

import { makeStudyClient, workflowSnapshots } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

for (const hinted of [true, false])
  test(`workflow subscription reseeds, follows ${hinted ? 'commit hints' : 'unhinted commits'}, and releases its listener`, async () => {
    const location = createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);
    const subscribe = app.store.subscribe.bind(app.store);
    let listeners = 0;
    let releases = 0;
    let released!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      released = resolve;
    });

    app.store.subscribe = (listener) => {
      listeners++;
      const unsubscribe = subscribe(listener);

      return () => {
        listeners--;
        unsubscribe();

        if (++releases === 2) released();
      };
    };

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const initial = yield* Deferred.make<void>();
            const fiber = yield* workflowSnapshots(client, { limit: 10 }).pipe(
              Stream.tap(() => Deferred.succeed(initial, undefined)),
              Stream.take(2),
              Stream.runCollect,
              Effect.forkChild
            );

            yield* Deferred.await(initial);
            const write = () =>
              app.store.db.orm
                .insert(workflow_executions)
                .values({
                  execution_id: 'subscription',
                  workflow_tag: 'test',
                  version: 1,
                  payload: '{}',
                  status: 'running',
                  created_at: 1n,
                  updated_at: 1n
                })
                .run();

            if (hinted) app.store.transaction(write);
            else write();

            const pages = yield* Fiber.join(fiber).pipe(Effect.timeout('3 seconds'));

            assert.equal(pages[0]?.items.length, 0);
            assert.equal(pages[1]?.items[0]?.id, 'subscription');
            const reseeded = yield* workflowSnapshots(client, { limit: 10 }).pipe(
              Stream.take(1),
              Stream.runCollect
            );

            assert.equal(reseeded[0]?.items[0]?.id, 'subscription');
          })
        )
      );
      await Promise.race([
        cleanup,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error('listener not released')), 2000)
        )
      ]);
      assert.equal(listeners, 0);
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  });
