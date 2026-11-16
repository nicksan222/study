import { agentRunIdSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies commit bursts produce bounded and current progress snapshots.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests subscription coalescing and final snapshots against real SQLite.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the workflow service with a controlled clock and owned execution.                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import type { agentProgressPageSchema } from '@study/contracts';
import { executionIdSchema } from '@study/contracts';
import { aiUsage, workflow_executions } from '@study/db';
import { ServerContext, Database, observeAgentProgress, WorkflowControl } from '@study/server';
import { test } from '@study/testing';
import { Effect, Fiber, Layer, Queue, Stream } from 'effect';
import { Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { Workflow, WorkflowEngine } from 'effect/workflow';

import { Workflows } from '#server/features/workflows/service/index';

test.server.stable(
  'coalesces commit bursts before rereading the latest preview',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const executionId = executionIdSchema.make('burst');
    const definition = Workflow.make('progress-burst', {
      payload: { id: Schema.String },
      idempotencyKey: ({ id }) => id
    });
    const instance = WorkflowEngine.WorkflowInstance.initial(definition, executionId);

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
    const observe = observeAgentProgress(context);
    const emit = (event: Parameters<typeof observe>[0]['event']) =>
      observe({
        runId: agentRunIdSchema.make('burst-agent'),
        agentId: 'reply',
        mode: 'text',
        event
      }).pipe(Effect.provideService(WorkflowEngine.WorkflowInstance, instance));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* emit({ type: 'start' });
          const workflows = yield* Workflows;
          const pages = yield* Queue.unbounded<typeof agentProgressPageSchema.Type>();
          const stream = yield* workflows.subscribeAgentProgress({ executionId });
          const viewer = yield* stream.pipe(
            Stream.runForEach((page) => Queue.offer(pages, page)),
            Effect.forkChild
          );

          expect((yield* Queue.take(pages))[0]?.text).toBe('');

          yield* emit({ type: 'text-delta', text: 'a' });
          yield* TestClock.adjust('50 millis');
          expect(yield* Queue.size(pages)).toBe(0);
          yield* emit({ type: 'text-delta', text: 'b' });
          yield* TestClock.adjust('50 millis');
          expect((yield* Queue.take(pages))[0]?.text).toBe('ab');

          yield* emit({ type: 'text-delta', text: 'tail' });
          yield* emit({ type: 'complete' });
          yield* TestClock.adjust('100 millis');
          expect((yield* Queue.take(pages))[0]).toMatchObject({
            text: 'abtail',
            status: 'completed'
          });
          context.transaction(['settings'], ({ db }) => {
            db.orm
              .insert(aiUsage)
              .values({
                id: 'late-usage',
                runId: 'burst-agent',
                agent: 'reply',
                provider: 'test',
                model: 'test',
                timestamp: 0,
                input: 20,
                output: 5,
                cacheRead: 0,
                cacheWrite: 0,
                reasoning: 0,
                incomplete: true
              })
              .run();
          });
          yield* TestClock.adjust('100 millis');
          expect(yield* Queue.size(pages)).toBe(1);
          expect((yield* Queue.take(pages))[0]?.usage).toEqual({
            input: 20,
            output: 5,
            requests: 1
          });
          yield* Fiber.interrupt(viewer);
        }).pipe(
          Effect.provide(
            Workflows.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(Database, { store: context }),
                  Layer.succeed(WorkflowControl, { cancel: () => Effect.void })
                )
              )
            )
          ),
          Effect.provide(TestClock.layer())
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
