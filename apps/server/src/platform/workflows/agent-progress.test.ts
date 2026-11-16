/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies durable agent snapshots and domain generation fencing.                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests commit notifications, durable reads and cancellation rejection.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real SQLite domain records and native workflow identities.                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { agentRunIdSchema } from '@study/contracts';
import { executionIdSchema } from '@study/contracts';
import { eq } from '@study/db';
import { workflow_executions } from '@study/db';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';
import { Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import {
  agentProgressSnapshot,
  observeAgentProgress
} from '#server/platform/workflows/agent-progress';

const definition = Workflow.make('progress-test', {
  payload: { id: Schema.String },
  idempotencyKey: ({ id }) => id
});

test.stable(
  'progress commits before notification and reads durable snapshots without the observer',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const executionId = executionIdSchema.make('stream-run');

    context.db.orm
      .insert(workflow_executions)
      .values({
        execution_id: executionId,
        workflow_tag: definition._tag,
        version: 1,
        payload: '{}',
        status: 'running',
        created_at: 0n,
        updated_at: 0n
      })
      .run();
    const instance = WorkflowEngine.WorkflowInstance.initial(definition, executionId);
    const observe = observeAgentProgress(context);
    const read = () => agentProgressSnapshot(context, { executionId });
    const snapshots: string[] = [];
    const unsubscribe = context.subscribe(() => snapshots.push(read()[0]?.text ?? ''));
    const emit = (event: Parameters<typeof observe>[0]['event'], run = 'agent') =>
      Effect.runPromise(
        observe({
          runId: agentRunIdSchema.make(run),
          agentId: 'reply',
          mode: 'text',
          event
        }).pipe(Effect.provideService(WorkflowEngine.WorkflowInstance, instance))
      );

    try {
      await emit({ type: 'start' });
      await emit({ type: 'text-delta', text: 'Hello' });
      test.expect(read()[0]?.text).toBe('Hello');
      test.expect(snapshots.at(-1)).toBe('Hello');
      unsubscribe();
      await emit({ type: 'complete' });
      test.expect(read()[0]?.status).toBe('completed');
      await emit({ type: 'start' }, 'next-section');
      test.expect(read().map((run) => run.runId)).toEqual(['agent', 'next-section']);
      test.expect(read()[0]?.text).toBe('Hello');
      await emit({ type: 'complete' }, 'next-section');

      for (let index = 0; index <= 100; index++) await emit({ type: 'start' }, `section-${index}`);

      test.expect(read()).toHaveLength(100);
      test.expect(read().at(-1)?.runId).toBe('section-100');
      context.db.orm
        .update(workflow_executions)
        .set({ generation: 2 })
        .where(eq(workflow_executions.execution_id, executionId))
        .run();
      test.expect(read()).toEqual([]);
      await emit({ type: 'start' });
      await emit({ type: 'text-delta', text: 'Current' });
      test.expect(read()[0]?.text).toBe('Current');
      test.expect(read()[0]?.status).toBe('running');
      context.db.orm
        .update(workflow_executions)
        .set({ cancellation_mode: 'unsafe', status: 'cancelling' })
        .where(eq(workflow_executions.execution_id, executionId))
        .run();
      await test.expect(emit({ type: 'text-delta', text: 'stale' })).rejects.toThrow();
      test.expect(read()).toEqual([]);
    } finally {
      unsubscribe();
      context.close();
      await location.cleanup();
    }
  }
);

for (const phase of ['preparing', 'compacting', 'generating', undefined] as const)
  test.stable(
    `persists semantic phase ${phase ?? 'default'} across reconnects and failures`,
    async ({ databases }) => {
      const location = await databases();
      let context = new ServerContext(await location.open());
      const executionId = executionIdSchema.make('phase-run');
      const instance = WorkflowEngine.WorkflowInstance.initial(definition, executionId);
      const emit = (event: Parameters<ReturnType<typeof observeAgentProgress>>[0]['event']) =>
        Effect.runPromise(
          observeAgentProgress(context)({
            runId: agentRunIdSchema.make('phase-agent'),
            agentId: 'reply',
            phase,
            mode: 'text',
            event
          }).pipe(Effect.provideService(WorkflowEngine.WorkflowInstance, instance))
        );
      const read = () => agentProgressSnapshot(context, { executionId })[0];

      try {
        context.db.orm
          .insert(workflow_executions)
          .values({
            execution_id: executionId,
            workflow_tag: definition._tag,
            version: 1,
            payload: '{}',
            status: 'running',
            created_at: 0n,
            updated_at: 0n
          })
          .run();
        await emit({ type: 'start' });
        await emit({ type: 'text-delta', text: 'Partial' });
        test.expect(read()).toMatchObject({
          phase: phase ?? 'generating',
          status: 'running',
          text: 'Partial'
        });
        context.close();
        context = new ServerContext(await location.open());
        test.expect(read()).toMatchObject({
          phase: phase ?? 'generating',
          status: 'running',
          text: 'Partial'
        });
        await emit({ type: 'failed', kind: 'transient' });
        context.close();
        context = new ServerContext(await location.open());
        test.expect(read()).toMatchObject({
          phase: phase ?? 'generating',
          status: 'failed',
          failureKind: 'transient'
        });
      } finally {
        context.close();
        await location.cleanup();
      }
    }
  );
