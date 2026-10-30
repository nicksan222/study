import assert from 'node:assert/strict';
import { test } from 'node:test';

import { workflow_clocks, workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';

import { ServerContext } from '#server/platform/database/context';
import { workflowStore } from '#server/platform/workflows/store';

test('recovery scans bound eligible known executions and due clocks without starvation', () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const store = workflowStore(context);
  const now = BigInt(Date.now());

  try {
    context.transaction(() => {
      for (let i = 0; i < 1002; i++) {
        for (const [prefix, tag, owner, updated] of [
          ['unknown', 'retired', null, 0n],
          ['active', 'known', 'owner', now],
          ['ready', 'known', null, 0n]
        ] as const) {
          const id = `${prefix}-${String(i).padStart(4, '0')}`;

          context.db.orm
            .insert(workflow_executions)
            .values({
              execution_id: id,
              workflow_tag: tag,
              version: 1,
              payload: '{}',
              status: 'running',
              owner_token: owner,
              created_at: 0n,
              updated_at: updated
            })
            .run();

          if (prefix !== 'active')
            context.db.orm
              .insert(workflow_clocks)
              .values({
                execution_id: id,
                name: 'clock',
                deferred_name: 'deferred',
                due_at: 0n
              })
              .run();
        }
      }

      context.db.orm
        .insert(workflow_executions)
        .values({
          execution_id: 'terminal',
          workflow_tag: 'known',
          version: 1,
          payload: '{}',
          status: 'completed',
          created_at: 0n,
          updated_at: 0n
        })
        .run();
      context.db.orm
        .insert(workflow_clocks)
        .values({
          execution_id: 'terminal',
          name: 'clock',
          deferred_name: 'deferred',
          due_at: 0n
        })
        .run();
    });
    const first = store.recoverable(['known']);

    assert.equal(first.length, 1000);
    assert.ok(first.every((row) => row.execution_id.startsWith('ready-')));
    const clocks = store.dueClocks(['known']);

    assert.equal(clocks.length, 1000);
    assert.ok(clocks.every((row) => row.execution_id.startsWith('ready-')));

    for (const row of first) assert.equal(store.claim(row.execution_id, 'owner'), true);

    for (const clock of clocks) store.removeClock(clock.execution_id, clock.name);

    assert.equal(store.recoverable(['known']).length, 2);
    assert.equal(store.dueClocks(['known']).length, 2);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('native recovery advances to the next batch while earlier runs remain leased', async () => {
  const { Effect, Schema } = await import('effect');
  const { Workflow, WorkflowEngine } = await import('effect/workflow');
  const { recoverWorkflowEngine, workflowEngineLayer } =
    await import('#server/platform/workflows/engine');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const workflow = Workflow.make('batch-recovery', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id
  });
  const store = workflowStore(context);

  try {
    context.transaction(() => {
      for (let i = 0; i < 1001; i++) {
        const id = String(i);

        store.start(id, workflow._tag, JSON.stringify({ id }), undefined);
      }
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => Effect.never);
          yield* recoverWorkflowEngine(context, engine, [workflow]);
          assert.equal(store.recoverable([workflow._tag]).length, 1);
          yield* recoverWorkflowEngine(context, engine, [workflow]);
          assert.equal(store.recoverable([workflow._tag]).length, 0);
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('expired leases and interruption markers remain recoverable; only live due clocks are delivered', () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const store = workflowStore(context);

  try {
    context.transaction(() => {
      for (const [id, status, owner, result, due] of [
        ['safe', 'running', 'expired', '"__interrupt_safe__"', 0n],
        ['unsafe', 'running', null, '"__interrupt_unsafe__"', 0n],
        ['suspended', 'suspended', null, null, 0n],
        ['future', 'suspended', null, null, BigInt(Date.now() + 60000)],
        ['cancelled', 'cancelled', null, null, 0n]
      ] as const) {
        context.db.orm
          .insert(workflow_executions)
          .values({
            execution_id: id,
            workflow_tag: 'known',
            version: 1,
            payload: '{}',
            status,
            owner_token: owner,
            result,
            created_at: 0n,
            updated_at: 0n
          })
          .run();
        context.db.orm
          .insert(workflow_clocks)
          .values({
            execution_id: id,
            name: 'clock',
            deferred_name: 'deferred',
            due_at: due
          })
          .run();
      }
    });
    assert.deepEqual(
      store.recoverable(['known']).map((row) => [row.execution_id, row.result]),
      [
        ['safe', '"__interrupt_safe__"'],
        ['unsafe', '"__interrupt_unsafe__"']
      ]
    );
    assert.deepEqual(
      store.dueClocks(['known']).map((row) => row.execution_id),
      ['safe', 'suspended', 'unsafe']
    );
    assert.deepEqual(store.recoverable([]), []);
    assert.deepEqual(store.dueClocks([]), []);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('native recovery delivers due clocks across batches and retains future clocks', async () => {
  const { Effect, Schema } = await import('effect');
  const { Workflow, WorkflowEngine } = await import('effect/workflow');
  const { recoverWorkflowEngine, workflowEngineLayer } =
    await import('#server/platform/workflows/engine');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const workflow = Workflow.make('clock-recovery', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id
  });
  const store = workflowStore(context);

  try {
    context.transaction(() => {
      for (let i = 0; i < 1002; i++) {
        const id = String(i);

        context.db.orm
          .insert(workflow_executions)
          .values({
            execution_id: id,
            workflow_tag: workflow._tag,
            version: 1,
            payload: JSON.stringify({ id }),
            status: 'suspended',
            created_at: 0n,
            updated_at: 0n
          })
          .run();
        context.db.orm
          .insert(workflow_clocks)
          .values({
            execution_id: id,
            name: 'clock',
            deferred_name: 'gate',
            due_at: i === 1001 ? BigInt(Date.now() + 60000) : 0n
          })
          .run();
      }
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => Effect.never);
          yield* recoverWorkflowEngine(context, engine, [workflow]);
          assert.equal(store.dueClocks([workflow._tag]).length, 1);
          yield* recoverWorkflowEngine(context, engine, [workflow]);
          assert.equal(store.dueClocks([workflow._tag]).length, 0);
          assert.equal(context.db.orm.select().from(workflow_clocks).all().length, 1);
          assert.ok(store.deferred('1000', 'gate'));
          assert.equal(store.deferred('1001', 'gate'), undefined);
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
