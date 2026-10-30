import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Effect } from 'effect';

import { createServerTest } from '#testing/server-test';

test('a start queued behind stop restarts the worker', async (t) => {
  const { app } = await createServerTest(t);

  await app.workers.start();
  const stopping = app.workers.stop();
  const starting = app.workers.start();

  await Promise.all([stopping, starting]);
  assert.equal(app.workers.started, true);
  await Promise.all([app.workers.stop(), app.workers.stop()]);
  assert.equal(app.workers.started, false);
});

test('close rejects a queued start and leaves the worker stopped', async (t) => {
  const { app } = await createServerTest(t);

  await app.workers.start();
  const stopping = app.workers.stop();
  const starting = app.workers.start();
  const closing = app.workers.close();

  await assert.rejects(starting);
  await Promise.all([stopping, closing, app.workers.close()]);
  assert.equal(app.workers.started, false);
  await assert.rejects(app.workers.start());
});

test('concurrent native fibers share one worker and stop idempotently', async (t) => {
  const { app } = await createServerTest(t);

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.all(
        Array.from({ length: 8 }, () => Effect.promise(() => app.workers.start())),
        { concurrency: 'unbounded' }
      );
      assert.equal(app.workers.started, true);
      yield* Effect.all(
        Array.from({ length: 8 }, () => Effect.promise(() => app.workers.stop())),
        { concurrency: 'unbounded' }
      );
      assert.equal(app.workers.started, false);
    })
  );
});
