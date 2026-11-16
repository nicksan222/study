import { eq } from '@study/db';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies unsupported persisted workflow versions remain durably visible.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks typed blocked reasons across real database reopening.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses official embedded infrastructure and real SQLite domain state.                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { workflow_executions, workflow_retired_executions } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, ManagedRuntime, Option, Schema, Schedule } from 'effect';
import { DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { scrubRetiredExecution } from '#server/platform/workflows/store';
import { refreshExecutionSnapshots } from '#server/platform/workflows/triggers';
import { admitTestExecution } from '#testing/workflow-admission';

test.stable(
  'unsupported workflow versions become durably blocked',
  async ({ databases, expect }) => {
    const location = await databases();
    const db = await location.open();
    const context = new ServerContext(db);
    const runtime = ManagedRuntime.make(workflowEngineLayer(context));

    try {
      db.orm
        .insert(workflow_executions)
        .values({
          execution_id: 'unsupported',
          workflow_tag: 'removed/v99',
          version: 99,
          payload: '{}',
          status: 'running',
          created_at: 1n,
          updated_at: 1n
        })
        .run();
      db.orm
        .insert(workflow_executions)
        .values({
          execution_id: 'unsupported-retired',
          workflow_tag: 'removed/v99',
          version: 99,
          payload: '{}',
          status: 'completed',
          created_at: 1n,
          updated_at: 1n
        })
        .run();
      db.orm
        .insert(workflow_retired_executions)
        .values({ execution_id: 'unsupported-retired', correlation_id: 'retired' })
        .run();
      await runtime.runPromise(refreshExecutionSnapshots(context, []));
      expect(db.orm.select().from(workflow_executions).get()?.status).toBe('blocked');
      expect(db.orm.select().from(workflow_executions).get()?.blocked_reason).toBe('unsupported');
      expect(
        db.orm
          .select()
          .from(workflow_executions)
          .where(eq(workflow_executions.execution_id, 'unsupported-retired'))
          .get()?.blocked_reason
      ).toBe('unsupported');
      let hints = 0;
      const unsubscribe = context.subscribe(() => hints++);

      await runtime.runPromise(refreshExecutionSnapshots(context, []));
      unsubscribe();
      expect(hints).toBe(0);
      await runtime.dispose();
      const reopened = await location.open();

      try {
        expect(reopened.orm.select().from(workflow_executions).get()?.status).toBe('blocked');
      } finally {
        reopened.close();
      }
    } finally {
      await runtime.dispose();
      db.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'unchanged durable snapshots do not publish hints or keep the worker awake',
  async ({ databases, expect }) => {
    const location = await databases();
    const db = await location.open();
    const context = new ServerContext(db);
    const workflow = Workflow.make('idle/v1', {
      payload: { id: Schema.String },
      idempotencyKey: ({ id }) => id
    });
    const runtime = ManagedRuntime.make(
      workflow
        .toLayer(() => DurableDeferred.await(DurableDeferred.make('idle')))
        .pipe(Layer.provideMerge(workflowEngineLayer(context)))
    );
    let hints = 0;
    const unsubscribe = context.subscribe(() => hints++);
    const triggers = [
      {
        subscription: 'idle',
        event: 'SourceIndexed' as const,
        workflowVersion: 1,
        workflow,
        emits: [],
        enabled: () => true
      }
    ];

    try {
      db.orm
        .insert(workflow_executions)
        .values({
          execution_id: 'idle',
          workflow_tag: workflow._tag,
          version: 1,
          payload: '{}',
          status: 'running',
          created_at: 1n,
          updated_at: 1n
        })
        .run();
      await runtime.runPromise(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.execute(workflow, {
            executionId: 'idle',
            payload: { id: 'idle' },
            discard: true
          });
          yield* engine.poll(workflow, 'idle').pipe(
            Effect.repeat({
              while: (reply) => Option.isNone(reply) || reply.value._tag !== 'Suspended',
              schedule: Schedule.spaced('10 millis')
            })
          );
          yield* refreshExecutionSnapshots(context, triggers);
        })
      );
      expect(hints).toBe(1);
      hints = 0;
      await runtime.runPromise(refreshExecutionSnapshots(context, triggers));
      await runtime.runPromise(refreshExecutionSnapshots(context, triggers));
      expect(hints).toBe(0);
    } finally {
      unsubscribe();
      await runtime.dispose();
      db.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'restart retires official replies for already completed domain work',
  async ({ databases, expect }) => {
    const location = await databases();
    const db = await location.open();
    const context = new ServerContext(db);
    const workflow = Workflow.make('completed-retirement/v1', {
      payload: { id: Schema.String },
      success: Schema.String,
      idempotencyKey: ({ id }) => id
    });
    let calls = 0;
    const layer = workflow
      .toLayer(() =>
        Effect.sync(() => {
          calls++;

          return 'private captured content';
        })
      )
      .pipe(Layer.provideMerge(workflowEngineLayer(context)));
    let runtime = ManagedRuntime.make(layer);
    const triggers = [
      {
        subscription: 'completed-retirement',
        event: 'SourceIndexed' as const,
        workflowVersion: 1,
        workflow,
        emits: [],
        enabled: () => true
      }
    ];

    try {
      admitTestExecution(context, workflow, 'completed', { id: 'completed' });
      await runtime.runPromise(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.execute(workflow, {
            executionId: 'completed',
            payload: { id: 'completed' }
          });
        })
      );
      context.transaction(['workflows'], (tx) => {
        tx.db.orm
          .update(workflow_executions)
          .set({ status: 'completed' })
          .where(eq(workflow_executions.execution_id, 'completed'))
          .run();
        tx.db.orm
          .insert(workflow_retired_executions)
          .values({ execution_id: 'completed', correlation_id: 'deleted' })
          .run();
        scrubRetiredExecution(tx.db, 'completed');
      });
      await runtime.dispose();
      runtime = ManagedRuntime.make(layer);
      await runtime.runPromise(refreshExecutionSnapshots(context, triggers));
      const reply = await runtime.runPromise(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          return yield* engine.poll(workflow, 'completed');
        })
      );

      expect(Option.isNone(reply)).toBe(true);
      expect(calls).toBe(1);
      expect(db.orm.select().from(workflow_executions).get()?.status).toBe('completed');
    } finally {
      await runtime.dispose();
      db.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'retirement between polling and snapshot commit cannot restore private output',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const workflow = Workflow.make('poll-retirement/v1', {
      payload: { id: Schema.String },
      success: Schema.String,
      idempotencyKey: ({ id }) => id
    });
    const runtime = ManagedRuntime.make(
      workflow
        .toLayer(() => Effect.succeed('private reply'))
        .pipe(Layer.provideMerge(workflowEngineLayer(context)))
    );
    const id = 'poll-retirement';

    const retireAfterPoll = Effect.sync(() => {
      context.db.orm
        .insert(workflow_retired_executions)
        .values({ execution_id: id, correlation_id: id })
        .run();
      scrubRetiredExecution(context.db, id);
    });

    try {
      admitTestExecution(context, workflow, id, { id });
      await runtime.runPromise(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.execute(workflow, { executionId: id, payload: { id } });
          const polling = {
            ...engine,
            poll: (...args: Parameters<typeof engine.poll>) =>
              engine.poll(...args).pipe(Effect.tap(() => retireAfterPoll))
          };

          yield* refreshExecutionSnapshots(context, [
            {
              subscription: id,
              event: 'SourceIndexed',
              workflowVersion: 1,
              workflow,
              emits: [],
              enabled: () => true
            }
          ]).pipe(Effect.provideService(WorkflowEngine.WorkflowEngine, polling));
        })
      );
      const row = context.db.orm.select().from(workflow_executions).get();

      expect(row?.result).toBeNull();
      expect(row?.payload).toBe('{}');
    } finally {
      await runtime.dispose();
      context.close();
      await location.cleanup();
    }
  }
);
