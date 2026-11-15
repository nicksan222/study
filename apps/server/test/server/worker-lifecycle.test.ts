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

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { createServerTest } from '#testing/server-test';

testStable('a start queued behind stop restarts the worker', async (t) => {
  const { app } = await createServerTest(t);

  await app.workers.start();
  const stopping = app.workers.stop();
  const starting = app.workers.start();

  await Promise.all([stopping, starting]);
  assert.isTrue(app.workers.started);
  await Promise.all([app.workers.stop(), app.workers.stop()]);
  assert.isFalse(app.workers.started);
});

testStable('close rejects a queued start and leaves the worker stopped', async (t) => {
  const { app } = await createServerTest(t);

  await app.workers.start();
  const stopping = app.workers.stop();
  const starting = app.workers.start();
  const closing = app.workers.close();

  await expect(starting).rejects.toSatisfy(() => true);
  await Promise.all([stopping, closing, app.workers.close()]);
  assert.isFalse(app.workers.started);
  await expect(app.workers.start()).rejects.toSatisfy(() => true);
});

testStable('concurrent native fibers share one worker and stop idempotently', async (t) => {
  const { app } = await createServerTest(t);

  function* verifySharedWorkerLifecycle() {
    yield* Effect.all(
      Array.from({ length: 8 }, () => Effect.promise(() => app.workers.start())),
      { concurrency: 'unbounded' }
    );
    assert.isTrue(app.workers.started);
    yield* Effect.all(
      Array.from({ length: 8 }, () => Effect.promise(() => app.workers.stop())),
      { concurrency: 'unbounded' }
    );
    assert.isFalse(app.workers.started);
  }

  await Effect.runPromise(Effect.gen(verifySharedWorkerLifecycle));
});

testStable(
  'shutdown interrupts safe cancellation waiting for an active provider',
  { timeout: 10000 },
  async (t) => {
    const { Sources } = await import('#server/features/sources/index');
    const { workflow_executions } = await import('@study/db');
    const { executionIdSchema } = await import('@study/contracts');
    const { Layer } = await import('effect');
    const { WorkflowEngine } = await import('effect/workflow');
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let entered!: () => void;
    const requested = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const peer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('<html>pending'));
              entered();
            }
          }),
          { headers: { 'content-type': 'text/html' } }
        )
    });

    t.onTestFinished(() => peer.stop(true));
    const { app } = await createServerTest(t);

    app.native.workflows = Layer.effect(
      WorkflowEngine.WorkflowEngine,
      Effect.map(WorkflowEngine.WorkflowEngine, (engine) => ({
        ...engine,
        interrupt: (...args: Parameters<typeof engine.interrupt>) =>
          Effect.sync(reached).pipe(
            Effect.andThen(engine.interrupt(...args)),
            Effect.andThen(Effect.never)
          )
      }))
    ).pipe(Layer.provideMerge(app.native.workflows));
    await app.workers.start();
    const sources = await app.nativeRuntime.runPromise(Sources);

    await app.nativeRuntime.runPromise(sources.addLink({ url: peer.url.origin, projectId: null }));
    await requested;
    const execution = app.store.db.orm
      .select()
      .from(workflow_executions)
      .all()
      .find((row) => row.workflow_tag === 'source-ingestion/v1');

    assert.ok(execution);
    let settled = false;
    const cancelling = app.workers
      .cancelExecution({ id: executionIdSchema.make(execution.execution_id), mode: 'safe' })
      .then(
        () => {
          settled = true;

          return undefined;
        },
        (error: unknown) => {
          settled = true;

          return error;
        }
      );

    await waiting;
    expect(settled).toBe(false);
    await Effect.runPromise(
      Effect.promise(() => app.close()).pipe(
        Effect.timeout('5 seconds'),
        Effect.catchCause((cause) =>
          Effect.die(new Error('close did not interrupt cancellation', { cause }))
        )
      )
    );
    expect(await cancelling).toBeInstanceOf(Error);
  }
);

testStable('stopped concurrent cancellations and start share one embedded runtime', async (t) => {
  const { Layer } = await import('effect');
  const { executionIdSchema } = await import('@study/contracts');
  const { app } = await createServerTest(t);
  let acquisitions = 0;

  app.native.workflows = app.native.workflows.pipe(
    Layer.tap(() =>
      Effect.sync(() => {
        acquisitions++;
      })
    )
  );
  const first = app.workers
    .cancelExecution({ id: executionIdSchema.make('absent-first'), mode: 'safe' })
    .catch(() => undefined);
  const second = app.workers
    .cancelExecution({ id: executionIdSchema.make('absent-second'), mode: 'safe' })
    .catch(() => undefined);

  await app.workers.start();
  await Promise.all([first, second]);
  await app.workers.runWorkflow(Effect.void);
  expect(acquisitions).toBe(1);
  await app.workers.stop();
  await app.workers.runWorkflow(Effect.void);
  expect(acquisitions).toBe(2);
  await app.workers.stop();
});

testStable(
  'stopped cancellation persists intent without acquiring the embedded runner',
  async (t) => {
    const { Layer } = await import('effect');
    const { workflow_executions } = await import('@study/db');
    const { executionIdSchema } = await import('@study/contracts');
    const { app } = await createServerTest(t);
    let acquisitions = 0;

    app.native.workflows = app.native.workflows.pipe(
      Layer.tap(() =>
        Effect.sync(() => {
          acquisitions++;
        })
      )
    );
    app.store.db.orm
      .insert(workflow_executions)
      .values({
        execution_id: 'stopped-cancel',
        workflow_tag: 'source-ingestion/v1',
        version: 1,
        payload: '{}',
        status: 'running',
        created_at: 1n,
        updated_at: 1n
      })
      .run();
    await app.workers.cancelExecution({
      id: executionIdSchema.make('stopped-cancel'),
      mode: 'unsafe'
    });
    expect(acquisitions).toBe(0);
    expect(app.workers.started).toBe(false);
    expect(app.store.db.orm.select().from(workflow_executions).get()?.cancellation_mode).toBe(
      'unsafe'
    );
  }
);
