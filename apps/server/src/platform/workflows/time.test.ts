/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies workflow leases, due clocks, and durable sleeps follow Effect’s           │
 * │ controllable test clock. SQLite deadlines and recovery behavior are checked at explicit  │
 * │ clock advances.                                                                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: SQLite workflow leases and due clocks follow the native test clock; native    │
 * │   durable sleep persists and fires at the controlled deadline.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/platform/database/context, #server/platform/workflows/store with real       │
 * │ SQLite and application resources; fixture cleanup closes owned resources.                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { workflow_clocks } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Clock, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { assert } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { workflowStore } from '#server/platform/workflows/store';

testStable('SQLite workflow leases and due clocks follow the native test clock', async () => {
  const location = createTestDatabase();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(100_000);
        const clock = yield* Clock.Clock;
        const context = new ServerContext(location.open(), clock);

        try {
          const store = workflowStore(context);

          store.start('one', 'test', '{}', undefined);
          assert.ok(store.claim('one', 'first') === true);
          store.clock('one', 'wake', 'deferred', 110_000n, 'first');
          assert.strictEqual(store.dueClocks(['test']).length, 0);
          const sleeping = yield* Effect.forkChild(Effect.sleep('10 seconds'));

          yield* TestClock.adjust('10 seconds');
          yield* Fiber.join(sleeping);
          assert.strictEqual(store.dueClocks(['test']).length, 1);
          assert.ok(store.claim('one', 'second') === false);
          yield* TestClock.adjust('20 seconds');
          assert.ok(store.claim('one', 'second') === true);
          assert.throws(() => store.assertOwner('one', 'first'));
        } finally {
          context.close();
        }
      }).pipe(Effect.provide(TestClock.layer()))
    );
  } finally {
    location.cleanup();
  }
});

testStable('native durable sleep persists and fires at the controlled deadline', async () => {
  const { Schema } = await import('effect');
  const { DurableClock, Workflow, WorkflowEngine } = await import('effect/workflow');
  const { workflowEngineLayer } = await import('#server/platform/workflows/engine');
  const location = createTestDatabase();

  try {
    function* verifyDurableDeadline() {
      yield* TestClock.setTime(100_000);
      const clock = yield* Clock.Clock;
      const context = new ServerContext(location.open(), clock);
      const workflow = Workflow.make('clock-test', {
        payload: { id: Schema.String },
        idempotencyKey: ({ id }) => id,
        success: Schema.String
      });
      let completed = false;

      try {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            function runWorkflow() {
              return Effect.gen(function* () {
                yield* DurableClock.sleep({
                  name: 'wake',
                  duration: '10 seconds',
                  inMemoryThreshold: 0
                });
                completed = true;

                return 'done';
              });
            }

            yield* engine.register(workflow, runWorkflow);
            yield* engine.execute(workflow, {
              executionId: 'one',
              payload: { id: 'one' },
              discard: true
            });

            for (let i = 0; i < 100 && !context.db.orm.select().from(workflow_clocks).get(); i++)
              yield* Effect.yieldNow;

            assert.strictEqual(
              context.db.orm.select().from(workflow_clocks).get()?.due_at,
              110_000n
            );
            yield* TestClock.adjust('9 seconds');
            assert.ok(completed === false);
            yield* TestClock.adjust('1 second');

            for (let i = 0; i < 100 && !completed; i++) yield* Effect.yieldNow;

            assert.isTrue(completed);
          }).pipe(Effect.provide(workflowEngineLayer(context)))
        );
      } finally {
        context.close();
      }
    }

    await Effect.runPromise(
      Effect.gen(verifyDurableDeadline).pipe(Effect.provide(TestClock.layer()))
    );
  } finally {
    location.cleanup();
  }
});
