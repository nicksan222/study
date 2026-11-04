/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises worker start and stop ordering, rejection of starts during close, and    │
 * │ concurrent lifecycle calls. Repeated stops are safe and concurrent starts share one      │
 * │ consumer.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: a start queued behind stop restarts the worker; close rejects a queued start  │
 * │   and leaves the worker stopped.                                                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the server test fixture with real SQLite and application resources; fixture cleanup │
 * │ closes owned resources.                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

import { createServerTest } from '#testing/server-test';

testStable('a start queued behind stop restarts the worker', async (t) => {
  const { app } = await createServerTest(t);

  await app.workers.start();
  const stopping = app.workers.stop();
  const starting = app.workers.start();

  await Promise.all([stopping, starting]);
  assert.equal(app.workers.started, true);
  await Promise.all([app.workers.stop(), app.workers.stop()]);
  assert.equal(app.workers.started, false);
});

testStable('close rejects a queued start and leaves the worker stopped', async (t) => {
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

testStable('concurrent native fibers share one worker and stop idempotently', async (t) => {
  const { app } = await createServerTest(t);

  function* verifySharedWorkerLifecycle() {
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
  }

  await Effect.runPromise(Effect.gen(verifySharedWorkerLifecycle));
});
