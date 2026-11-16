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

import { executionIdSchema } from '@study/contracts';
import { workflow_executions, workflow_agent_progress } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';

test.stable('a start queued behind stop restarts the worker', async ({ server: serverFixture }) => {
  const { app } = serverFixture;

  await app.workers.start();
  const stopping = app.workers.stop();
  const starting = app.workers.start();

  await Promise.all([stopping, starting]);
  test.assert.isTrue(app.workers.started);
  await Promise.all([app.workers.stop(), app.workers.stop()]);
  test.assert.isFalse(app.workers.started);
});

test.stable(
  'close rejects a queued start and leaves the worker stopped',
  async ({ server: serverFixture }) => {
    const { app } = serverFixture;

    await app.workers.start();
    const stopping = app.workers.stop();
    const starting = app.workers.start();
    const closing = app.workers.close();

    await test.expect(starting).rejects.toSatisfy(() => true);
    await Promise.all([stopping, closing, app.workers.close()]);
    test.assert.isFalse(app.workers.started);
    await test.expect(app.workers.start()).rejects.toSatisfy(() => true);
  }
);

test.stable(
  'concurrent native fibers share one worker and stop idempotently',
  async ({ server: serverFixture }) => {
    const { app } = serverFixture;

    function* verifySharedWorkerLifecycle() {
      yield* Effect.all(
        Array.from({ length: 8 }, () => Effect.promise(() => app.workers.start())),
        { concurrency: 'unbounded' }
      );
      test.assert.isTrue(app.workers.started);
      yield* Effect.all(
        Array.from({ length: 8 }, () => Effect.promise(() => app.workers.stop())),
        { concurrency: 'unbounded' }
      );
      test.assert.isFalse(app.workers.started);
    }

    await Effect.runPromise(Effect.gen(verifySharedWorkerLifecycle));
  }
);

test.stable(
  'shutdown interrupts safe cancellation waiting for an active provider',
  { timeout: 10000 },
  async ({ server: serverFixture, onTestFinished }) => {
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

    onTestFinished(() => peer.stop(true));
    const { app } = serverFixture;

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

    test.assert.ok(execution);
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
    test.expect(settled).toBe(false);
    await Effect.runPromise(
      Effect.promise(() => app.close()).pipe(
        Effect.timeout('5 seconds'),
        Effect.catchCause((cause) =>
          Effect.die(new Error('close did not interrupt cancellation', { cause }))
        )
      )
    );
    test.expect(await cancelling).toBeInstanceOf(Error);
  }
);

test.stable(
  'stopped concurrent cancellations and start share one embedded runtime',
  async ({ server: serverFixture }) => {
    const { Layer } = await import('effect');
    const { executionIdSchema } = await import('@study/contracts');
    const { app } = serverFixture;
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
    test.expect(acquisitions).toBe(1);
    await app.workers.stop();
    await app.workers.runWorkflow(Effect.void);
    test.expect(acquisitions).toBe(2);
    await app.workers.stop();
  }
);

test.stable(
  'stopped cancellation persists intent without acquiring the embedded runner',
  async ({ server: serverFixture }) => {
    const { Layer } = await import('effect');
    const { workflow_executions } = await import('@study/db');
    const { executionIdSchema } = await import('@study/contracts');
    const { app } = serverFixture;
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
    test.expect(acquisitions).toBe(0);
    test.expect(app.workers.started).toBe(false);
    test
      .expect(app.store.db.orm.select().from(workflow_executions).get()?.cancellation_mode)
      .toBe('unsafe');
  }
);

test.stable(
  'restart after failed disposal preserves previews owned by the retained runtime',
  async ({ server: serverFixture }) => {
    const { app } = serverFixture;

    app.native.workflows = app.native.workflows.pipe(
      Layer.tap(() => Effect.addFinalizer(() => Effect.die(new Error('Disposal failed'))))
    );
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const executionId = executionIdSchema.make('retained-progress');

    app.store.db.orm
      .insert(workflow_executions)
      .values({
        execution_id: executionId,
        workflow_tag: 'retained-progress-test',
        version: 1,
        payload: '{}',
        status: 'running',
        created_at: 0n,
        updated_at: 0n
      })
      .run();
    const running = app.workers
      .runWorkflow(
        Effect.promise(() => {
          app.store.db.orm
            .insert(workflow_agent_progress)
            .values({
              run_id: 'active',
              execution_id: executionId,
              generation: 1,
              activity_name: 'reply',
              attempt: 1,
              agent_id: 'reply',
              mode: 'text',
              status: 'running',
              revision: 0n,
              updated_at: 0n
            })
            .run();
          entered.resolve();

          return resume.promise;
        })
      )
      .catch((error: unknown) => error);

    try {
      await entered.promise;
      await test.expect(app.workers.stop()).rejects.toSatisfy(() => true);
      test.expect(app.workers.started).toBe(false);
      await app.workers.start();
      test
        .expect(app.store.db.orm.select().from(workflow_agent_progress).get()?.run_id)
        .toBe('active');
      resume.resolve();
      await running;
      await app.workers.stop();
    } finally {
      resume.resolve();
      await running;
    }
  }
);

test.stable(
  'recovery discards interrupted previews but preserves completed and concurrent steps',
  async ({ server: serverFixture }) => {
    const { app } = serverFixture;
    const executionId = executionIdSchema.make('progress-recovery');

    app.store.db.orm
      .insert(workflow_executions)
      .values({
        execution_id: executionId,
        workflow_tag: 'progress-recovery-test',
        version: 1,
        payload: '{}',
        status: 'running',
        created_at: 0n,
        updated_at: 0n
      })
      .run();
    const seed = (runId: string, status: 'running' | 'completed' = 'running') =>
      app.store.db.orm
        .insert(workflow_agent_progress)
        .values({
          run_id: runId,
          execution_id: executionId,
          generation: 1,
          activity_name: 'reply',
          attempt: 1,
          agent_id: 'reply',
          mode: 'text',
          status,
          revision: 0n,
          updated_at: 0n
        })
        .run();
    const read = () => app.store.db.orm.select().from(workflow_agent_progress).all();

    seed('finished', 'completed');
    seed('interrupted');
    await app.workers.start();
    test.expect(read().map((run) => run.run_id)).toEqual(['finished']);

    seed('parallel-a');
    seed('parallel-b');
    await app.workers.start();
    test.expect(read().map((run) => run.run_id)).toEqual(['finished', 'parallel-a', 'parallel-b']);
    await app.workers.stop();
    await app.workers.start();
    test.expect(read().map((run) => run.run_id)).toEqual(['finished']);
  }
);
