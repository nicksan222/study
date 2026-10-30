import assert from 'node:assert/strict';
import { test } from 'node:test';

import { failureSchema } from '@study/contracts/errors';
import { eq } from '@study/db';
import { workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Deferred, Effect, Exit, Option, Schema } from 'effect';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { workflowStore } from '#server/platform/workflows/store';

test('duplicate deferred delivery does not restart an activity after the wait has completed', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  let calls = 0;
  let interruptions = 0;
  const workflow = Workflow.make('duplicate-wake', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id,
    success: Schema.Number
  });
  const gate = DurableDeferred.make('gate');

  try {
    function* verifyDuplicateDelivery() {
      const engine = yield* WorkflowEngine.WorkflowEngine;
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();

      function recordInterruption() {
        return Effect.sync(() => {
          interruptions++;
        });
      }

      function runWorkflow() {
        return Effect.gen(function* () {
          yield* DurableDeferred.await(gate);

          return yield* Activity.make({
            name: 'paid-operation',
            success: Schema.Number,
            execute: Effect.gen(function* () {
              calls++;
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(finish);

              return calls;
            }).pipe(Effect.onInterrupt(recordInterruption))
          });
        });
      }

      yield* engine.register(workflow, runWorkflow);
      yield* engine.execute(workflow, {
        executionId: 'one',
        payload: { id: 'one' },
        discard: true
      });
      let state = yield* engine.poll(workflow, 'one');

      while (Option.isNone(state)) {
        yield* Effect.sleep('5 millis');
        state = yield* engine.poll(workflow, 'one');
      }

      const delivery = {
        workflowName: workflow._tag,
        executionId: 'one',
        deferredName: gate.name,
        exit: Exit.void
      };

      yield* engine.deferredDone(gate, delivery);
      yield* Deferred.await(started);
      yield* engine.deferredDone(gate, delivery);
      yield* Deferred.succeed(finish, undefined);

      for (let i = 0; i < 100; i++) {
        state = yield* engine.poll(workflow, 'one');

        if (Option.isSome(state) && state.value._tag === 'Complete') break;

        yield* Effect.sleep('5 millis');
      }

      assert.ok(Option.isSome(state) && state.value._tag === 'Complete');
      assert.equal(interruptions, 0);
      assert.equal(calls, 1);
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(verifyDuplicateDelivery).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('replays a completed native activity after suspension and reopening SQLite', async () => {
  const location = createTestDatabase();
  let calls = 0;
  const workflow = Workflow.make('replay-test', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id,
    success: Schema.Number
  });
  const activity = Activity.make({
    name: 'count',
    success: Schema.Number,
    execute: Effect.sync(() => ++calls)
  });
  const gate = DurableDeferred.make('gate');
  const handler = () =>
    Effect.gen(function* () {
      const value = yield* activity;

      yield* DurableDeferred.await(gate);

      return value;
    });
  const first = (context: ServerContext) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, handler);
          yield* engine.execute(workflow, {
            executionId: 'one',
            payload: { id: 'one' },
            discard: true
          });
          let result = yield* engine.poll(workflow, 'one');

          while (Option.isNone(result)) {
            yield* Effect.sleep('10 millis');
            result = yield* engine.poll(workflow, 'one');
          }

          assert.equal(result.value._tag, 'Suspended');
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
  const second = (context: ServerContext) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, handler);
          yield* engine.deferredDone(gate, {
            workflowName: workflow._tag,
            executionId: 'one',
            deferredName: gate.name,
            exit: Exit.void
          });

          return yield* engine.execute(workflow, { executionId: 'one', payload: { id: 'one' } });
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
  let context = new ServerContext(location.open());

  try {
    await first(context);
    context.close();
    context = new ServerContext(location.open());
    assert.equal(await second(context), 1);
    assert.equal(calls, 1);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('SQLite leases prevent concurrent claims and fence expired owners', () => {
  const location = createTestDatabase();
  const first = new ServerContext(location.open());
  const second = new ServerContext(location.open());

  try {
    const a = workflowStore(first);
    const b = workflowStore(second);

    a.start('lease', 'test', '{}', undefined);
    assert.equal(a.claim('lease', 'a'), true);
    assert.equal(b.claim('lease', 'b'), false);
    first.db.orm
      .update(workflow_executions)
      .set({ updated_at: 0n })
      .where(eq(workflow_executions.execution_id, 'lease'))
      .run();
    assert.equal(b.claim('lease', 'b'), true);
    assert.throws(() => a.checkpoint('lease', 'a', '{}', 'completed'), /fenced/);
    assert.throws(() => a.saveActivity('lease', 'a', 'activity', 1, '{}'), /fenced/);
  } finally {
    first.close();
    second.close();
    location.cleanup();
  }
});

test('a cancelled suspended execution stays cancelled after reopening SQLite', async () => {
  const location = createTestDatabase();
  let calls = 0;
  let finalizers = 0;
  const workflow = Workflow.make('cancel-test', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id
  });
  const activity = Activity.make({
    name: 'once',
    execute: Effect.sync(() => {
      calls++;
    })
  });
  const gate = DurableDeferred.make('gate');

  function* cancelSuspendedExecution() {
    yield* Workflow.addFinalizer((exit) =>
      Effect.sync(() => {
        if (Exit.isFailure(exit)) finalizers++;
      })
    );
    yield* activity;
    yield* DurableDeferred.await(gate);
  }

  const handler = () => Effect.gen(cancelSuspendedExecution);
  let context = new ServerContext(location.open());

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, handler);
          yield* engine.execute(workflow, {
            executionId: 'cancel',
            payload: { id: 'cancel' },
            discard: true
          });

          while (Option.isNone(yield* engine.poll(workflow, 'cancel')))
            yield* Effect.sleep('10 millis');

          yield* engine.interrupt(workflow, 'cancel');
          yield* Effect.sleep('50 millis');
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
    assert.equal(workflowStore(context).execution('cancel')?.status, 'cancelled');
    context.close();
    context = new ServerContext(location.open());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, handler);
          yield* engine.resume(workflow, 'cancel');
          yield* Effect.sleep('50 millis');
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
    assert.equal(calls, 1);
    assert.equal(finalizers, 1);
    assert.equal(workflowStore(context).execution('cancel')?.status, 'cancelled');
  } finally {
    context.close();
    location.cleanup();
  }
});

test('a pending interruption is recovered after reopening without starting another activity', async () => {
  const location = createTestDatabase();
  let calls = 0;
  const workflow = Workflow.make('pending-cancel', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id
  });
  const activity = Activity.make({
    name: 'new-work',
    execute: Effect.sync(() => {
      calls++;
    })
  });
  let context = new ServerContext(location.open());

  try {
    workflowStore(context).start('pending', workflow._tag, '{"id":"pending"}', undefined);
    workflowStore(context).interrupt('pending', 'safe');
    context.close();
    context = new ServerContext(location.open());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);
          yield* engine.resume(workflow, 'pending');

          while (workflowStore(context).execution('pending')?.status !== 'cancelled')
            yield* Effect.sleep('10 millis');
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
    assert.equal(calls, 0);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('two engines sharing SQLite do not run an activity concurrently', async () => {
  const location = createTestDatabase();
  const first = new ServerContext(location.open());
  const second = new ServerContext(location.open());
  let started!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const workflow = Workflow.make('exclusive', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id
  });
  const activity = Activity.make({
    name: 'work',
    execute: Effect.promise(async () => {
      calls++;
      started();
      await gate;
    })
  });
  const run = (context: ServerContext, wait: boolean) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);
          yield* engine.execute(workflow, {
            executionId: 'exclusive',
            payload: { id: 'exclusive' },
            discard: true
          });

          if (wait) yield* Effect.promise(() => gate);
          else yield* Effect.sleep('50 millis');
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );

  try {
    const active = run(first, true);

    await entered;
    await run(second, false);
    assert.equal(calls, 1);
    finish();
    await active;
  } finally {
    finish();
    first.close();
    second.close();
    location.cleanup();
  }
});

test('unsafe interruption preempts a running activity and persists cancellation', async () => {
  const location = createTestDatabase();
  let calls = 0;
  const workflow = Workflow.make('unsafe-cancel', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id
  });
  const activity = Activity.make({
    name: 'blocked',
    execute: Effect.sync(() => {
      calls++;
    }).pipe(Effect.andThen(Effect.never))
  });
  let context = new ServerContext(location.open());

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);
          yield* engine.execute(workflow, {
            executionId: 'unsafe',
            payload: { id: 'unsafe' },
            discard: true
          });

          while (calls === 0) yield* Effect.sleep('10 millis');

          yield* engine.interruptUnsafe(workflow, 'unsafe');

          while (workflowStore(context).execution('unsafe')?.status !== 'cancelled')
            yield* Effect.sleep('10 millis');
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
    context.close();
    context = new ServerContext(location.open());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);
          yield* engine.resume(workflow, 'unsafe');
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
    assert.equal(calls, 1);
    assert.equal(workflowStore(context).execution('unsafe')?.status, 'cancelled');
  } finally {
    context.close();
    location.cleanup();
  }
});

test('an activity receives its captured engine lease and cannot adopt a replacement owner', async () => {
  const { currentWorkflowActivityOwner } = await import('#server/platform/workflows/ownership');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const workflow = Workflow.make('ownership-capability-test', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id,
    success: Schema.String,
    error: failureSchema
  });

  try {
    function* verifyCapturedLease() {
      const engine = yield* WorkflowEngine.WorkflowEngine;

      function runWorkflow() {
        return Activity.make({
          name: 'capture-owner',
          success: Schema.String,
          error: failureSchema,
          execute: Effect.gen(function* () {
            const owner = yield* currentWorkflowActivityOwner;

            assert.equal(owner.executionId, 'captured');
            assert.equal(owner.activityName, 'capture-owner');
            assert.ok(owner.ownerToken.length > 0);
            const store = workflowStore(context);

            assert.equal(store.execution(owner.executionId)?.owner_token, owner.ownerToken);
            // A newer lease in SQLite cannot change the granted identity.
            context.db.orm
              .update(workflow_executions)
              .set({ owner_token: 'replacement' })
              .where(eq(workflow_executions.execution_id, owner.executionId))
              .run();
            assert.equal((yield* currentWorkflowActivityOwner).ownerToken, owner.ownerToken);
            assert.throws(() => store.assertOwner(owner.executionId, owner.ownerToken), /fenced/);
            context.db.orm
              .update(workflow_executions)
              .set({ owner_token: owner.ownerToken })
              .where(eq(workflow_executions.execution_id, owner.executionId))
              .run();

            return owner.executionId;
          })
        });
      }

      yield* engine.register(workflow, runWorkflow);

      return yield* engine.execute(workflow, {
        executionId: 'captured',
        payload: { id: 'captured' }
      });
    }

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(verifyCapturedLease).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );

    assert.equal(result, 'captured');
  } finally {
    context.close();
    location.cleanup();
  }
});

test('closing an expired engine cannot release a replacement engine claim', async () => {
  const location = createTestDatabase();
  const first = new ServerContext(location.open());
  const second = new ServerContext(location.open());
  const workflow = Workflow.make('replacement-owner', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id
  });

  function run(context: ServerContext) {
    let entered!: () => void;
    let close!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const closing = new Promise<void>((resolve) => {
      close = resolve;
    });
    const done = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () =>
            Activity.make({
              name: 'pending',
              execute: Effect.sync(entered).pipe(Effect.andThen(Effect.never))
            })
          );
          yield* engine.execute(workflow, {
            executionId: 'replacement',
            payload: { id: 'replacement' },
            discard: true
          });
          yield* Effect.promise(() => closing);
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );

    return { started, close, done };
  }

  const old = run(first);
  let replacement: ReturnType<typeof run> | undefined;

  try {
    await old.started;
    first.db.orm
      .update(workflow_executions)
      .set({ updated_at: 0n })
      .where(eq(workflow_executions.execution_id, 'replacement'))
      .run();
    replacement = run(second);
    await replacement.started;
    const owner = workflowStore(second).execution('replacement')?.owner_token;

    assert.ok(owner);
    old.close();
    await old.done;
    assert.equal(workflowStore(second).execution('replacement')?.owner_token, owner);
    assert.equal(workflowStore(second).execution('replacement')?.status, 'running');
    replacement.close();
    await replacement.done;
    assert.equal(workflowStore(second).execution('replacement')?.owner_token, null);
  } finally {
    old.close();
    replacement?.close();
    await old.done;
    await replacement?.done;
    first.close();
    second.close();
    location.cleanup();
  }
});

test('a suspended run can resume in the same engine after its fiber completes', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const workflow = Workflow.make('same-engine-resume', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id,
    success: Schema.String
  });
  const gate = DurableDeferred.make('same-engine-gate');
  let calls = 0;
  const activity = Activity.make({
    name: 'once-before-resume',
    execute: Effect.sync(() => {
      calls++;
    })
  });

  try {
    function* verifySameEngineResume() {
      const engine = yield* WorkflowEngine.WorkflowEngine;

      yield* engine.register(workflow, () =>
        Effect.gen(function* () {
          yield* activity;
          yield* DurableDeferred.await(gate);

          return 'resumed';
        })
      );
      yield* engine.execute(workflow, {
        executionId: 'same-engine',
        payload: { id: 'same-engine' },
        discard: true
      });

      while (Option.isNone(yield* engine.poll(workflow, 'same-engine')))
        yield* Effect.sleep('10 millis');

      yield* engine.deferredDone(gate, {
        workflowName: workflow._tag,
        executionId: 'same-engine',
        deferredName: gate.name,
        exit: Exit.void
      });
      let result = yield* engine.poll(workflow, 'same-engine');

      while (Option.isNone(result) || result.value._tag !== 'Complete') {
        yield* Effect.sleep('10 millis');
        result = yield* engine.poll(workflow, 'same-engine');
      }

      return yield* engine.execute(workflow, {
        executionId: 'same-engine',
        payload: { id: 'same-engine' }
      });
    }

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(verifySameEngineResume).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );

    assert.equal(result, 'resumed');
    assert.equal(calls, 1);
  } finally {
    context.close();
    location.cleanup();
  }
});
