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

import { agentRunIdSchema } from '@study/contracts/ai/progress';
import type { agentProgressPageSchema } from '@study/contracts/ai/progress';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Fiber, Layer, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { expect } from 'vite-plus/test';

import { Workflows } from '#server/features/workflows/service/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { observeAgentProgress } from '#server/platform/workflows/agent-progress';
import { WorkflowControl } from '#server/platform/workflows/control';
import { WorkflowActivityOwner } from '#server/platform/workflows/ownership';
import { workflowStore } from '#server/platform/workflows/store';

testStable('coalesces commit bursts before rereading the latest preview', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const executionId = executionIdSchema.make('burst');
  const owner = { executionId, ownerToken: 'owner', activityName: 'generate', attempt: 0 };
  const store = workflowStore(context);

  store.start(executionId, 'reply', '{}', undefined);
  store.claim(executionId, owner.ownerToken);
  const observe = observeAgentProgress(context);
  const emit = (event: Parameters<typeof observe>[0]['event']) =>
    observe({
      runId: agentRunIdSchema.make('burst-agent'),
      agentId: 'reply',
      mode: 'text',
      event
    }).pipe(Effect.provideService(WorkflowActivityOwner, owner));

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
    location.cleanup();
  }
});
