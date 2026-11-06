/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies durable generation previews remain recoverable and fenced by activity     │
 * │ ownership.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests committed text, tool progress, cancellation fences and retirement cleanup.       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real temporary SQLite databases and captured workflow activity owners for           │
 * │ isolation.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { agentRunIdSchema } from '@study/contracts/ai/progress';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { eq } from '@study/db';
import {
  workflow_agent_progress,
  workflow_executions,
  workflow_retired_executions
} from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import {
  agentProgressSnapshot,
  observeAgentProgress
} from '#server/platform/workflows/agent-progress';
import { WorkflowActivityOwner } from '#server/platform/workflows/ownership';
import { scrubRetiredExecution, workflowStore } from '#server/platform/workflows/store';

testStable(
  'commits streamed text and tool lifecycle before notifying and recovers a snapshot',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const executionId = executionIdSchema.make('stream-run');
    const store = workflowStore(context);

    store.start(
      executionId,
      'reply',
      JSON.stringify({ event: { correlationId: 'request' } }),
      undefined
    );
    store.claim(executionId, 'owner');
    const observe = observeAgentProgress(context);
    const read = () => agentProgressSnapshot(context, { executionId });
    const notifications: string[] = [];
    const unsubscribe = context.subscribe(() => notifications.push(read()[0]?.text ?? ''));
    const emit = (event: Parameters<typeof observe>[0]['event']) =>
      Effect.runPromise(
        observe({
          runId: agentRunIdSchema.make('agent-run'),
          agentId: 'reply',
          mode: 'text',
          event
        }).pipe(
          Effect.provideService(WorkflowActivityOwner, {
            executionId,
            ownerToken: 'owner',
            activityName: 'generate',
            attempt: 0
          })
        )
      );

    try {
      await emit({ type: 'start' });
      await emit({ type: 'text-delta', text: 'Hello ' });
      await emit({ type: 'tool-start', toolCallId: 'call', toolName: 'sources' });
      await emit({
        type: 'tool-finish',
        toolCallId: 'call',
        toolName: 'sources',
        outcome: 'success'
      });
      await emit({ type: 'text-delta', text: 'world' });
      expect(read()[0]).toMatchObject({
        text: 'Hello world',
        status: 'running',
        tools: [{ toolCallId: 'call', toolName: 'sources', status: 'completed' }]
      });
      expect(notifications.at(-1)).toBe('Hello world');
      await emit({ type: 'complete' });
      expect(read()[0]?.status).toBe('completed');
      expect(agentProgressSnapshot(context, { correlationId: 'request' })[0]?.text).toBe(
        'Hello world'
      );

      context.db.orm
        .update(workflow_executions)
        .set({ owner_token: 'replacement' })
        .where(eq(workflow_executions.execution_id, executionId))
        .run();
      await expect(emit({ type: 'text-delta', text: 'stale' })).rejects.toMatchObject({
        kind: 'cancelled'
      });
      expect(read()).toEqual([]);
    } finally {
      unsubscribe();
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'interrupting a workflow fences progress and retiring it scrubs captured output',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const executionId = executionIdSchema.make('cancel-stream');
    const store = workflowStore(context);

    store.start(executionId, 'reply', '{}', undefined);
    store.claim(executionId, 'owner');
    const observe = observeAgentProgress(context);
    const emit = (event: Parameters<typeof observe>[0]['event']) =>
      Effect.runPromise(
        observe({
          runId: agentRunIdSchema.make('cancel-agent'),
          agentId: 'reply',
          mode: 'text',
          event
        }).pipe(
          Effect.provideService(WorkflowActivityOwner, {
            executionId,
            ownerToken: 'owner',
            activityName: 'generate',
            attempt: 0
          })
        )
      );

    try {
      await emit({ type: 'start' });
      await emit({ type: 'text-delta', text: 'private' });
      store.interrupt(executionId, 'safe');
      await expect(emit({ type: 'complete' })).rejects.toMatchObject({ kind: 'cancelled' });
      expect(agentProgressSnapshot(context, { executionId })).toEqual([]);
      context.transaction(() => {
        context.db.orm
          .insert(workflow_retired_executions)
          .values({ execution_id: executionId, correlation_id: 'retired' })
          .run();
        scrubRetiredExecution(context.db, executionId);
      });
      expect(context.db.orm.select().from(workflow_agent_progress).all()).toEqual([]);
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
