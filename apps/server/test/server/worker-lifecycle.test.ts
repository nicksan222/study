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

test.server.stable(
  'a start queued behind stop restarts the worker',
  async ({ server: serverFixture, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { app } = serverFixture;

    await app.workers.start();
    const stopping = app.workers.stop();
    const starting = app.workers.start();

    await Promise.all([stopping, starting]);
    assert.isTrue(app.workers.started);
    await Promise.all([app.workers.stop(), app.workers.stop()]);
    assert.isFalse(app.workers.started);
  }
);

test.server.stable(
  'a workflow aborted while acquiring the worker does not start its effect',
  async ({ server: { app }, expect }) => {
    await app.workers.runWorkflow(Effect.void);
    const controller = new AbortController();
    let started = false;
    const running = app.workers.runWorkflow(
      Effect.sync(() => {
        started = true;
      }),
      controller.signal
    );

    controller.abort();
    await expect(running).rejects.toMatchObject({ kind: 'cancelled' });
    expect(started).toBe(false);
  }
);

test.server.stable(
  'close rejects a queued start and leaves the worker stopped',
  async ({ server: serverFixture, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { app } = serverFixture;

    await app.workers.start();
    const stopping = app.workers.stop();
    const starting = app.workers.start();
    const closing = app.workers.close();

    await expect(starting).rejects.toSatisfy(() => true);
    await Promise.all([stopping, closing, app.workers.close()]);
    assert.isFalse(app.workers.started);
    await expect(app.workers.start()).rejects.toSatisfy(() => true);
  }
);

test.server.stable(
  'concurrent native fibers share one worker and stop idempotently',
  async ({ server: serverFixture, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { app } = serverFixture;

    function* verifySharedWorkerLifecycle({
      assert: assertions
    }: Pick<test.server.Context, 'assert'>) {
      const assert: test.Assert = assertions;

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

    await Effect.runPromise(Effect.gen(() => verifySharedWorkerLifecycle({ assert })));
  }
);

test.server.stable(
  'shutdown interrupts safe cancellation waiting for an active provider',
  { timeout: 10000 },
  async ({ server: serverFixture, onTestFinished, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

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

test.server.stable(
  'stopped concurrent cancellations and start share one embedded runtime',
  async ({ server: serverFixture, expect }) => {
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
    expect(acquisitions).toBe(1);
    await app.workers.stop();
    await app.workers.runWorkflow(Effect.void);
    expect(acquisitions).toBe(2);
    await app.workers.stop();
  }
);

test.server.stable(
  'stopped cancellation persists intent without acquiring the embedded runner',
  async ({ server: serverFixture, expect }) => {
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
    expect(acquisitions).toBe(0);
    expect(app.workers.started).toBe(false);
    expect(app.store.db.orm.select().from(workflow_executions).get()?.cancellation_mode).toBe(
      'unsafe'
    );
  }
);

test.server.stable(
  'restart after failed disposal preserves previews owned by the retained runtime',
  async ({ server: serverFixture, expect }) => {
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
      await expect(app.workers.stop()).rejects.toSatisfy(() => true);
      expect(app.workers.started).toBe(false);
      await app.workers.start();
      expect(app.store.db.orm.select().from(workflow_agent_progress).get()?.run_id).toBe('active');
      resume.resolve();
      await running;
      await app.workers.stop();
    } finally {
      resume.resolve();
      await running;
    }
  }
);

test.server.stable(
  'recovery retains interrupted steps as cancelled and preserves completed and concurrent work',
  async ({ server: serverFixture, expect }) => {
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
    expect(
      read().map(({ run_id, status, failure_kind }) => ({ run_id, status, failure_kind }))
    ).toEqual([
      { run_id: 'finished', status: 'completed', failure_kind: null },
      { run_id: 'interrupted', status: 'cancelled', failure_kind: 'cancelled' }
    ]);

    seed('parallel-a');
    seed('parallel-b');
    await app.workers.start();
    expect(read().map((run) => [run.run_id, run.status])).toEqual([
      ['finished', 'completed'],
      ['interrupted', 'cancelled'],
      ['parallel-a', 'running'],
      ['parallel-b', 'running']
    ]);
    await app.workers.stop();
    await app.workers.start();
    expect(read().map((run) => [run.run_id, run.status, run.revision])).toEqual([
      ['finished', 'completed', 0n],
      ['interrupted', 'cancelled', 1n],
      ['parallel-a', 'cancelled', 1n],
      ['parallel-b', 'cancelled', 1n]
    ]);
  }
);
