/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies live generation snapshots cross the real streaming HTTP RPC transport.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests partial output, reconnect snapshots and subscription resource cleanup.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the production application runtime and isolated SQLite; viewers never own           │
 * │ generation cancellation.                                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { StudyRpc } from '@study/contracts/rpc';
import { AgentRule } from '@study/contracts/settings/schemas';
import { defaultAgentRules } from '@study/contracts/settings/types';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Deferred, Effect, Fiber, Schema, Stream } from 'effect';
import { expect } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { generateAgent, layer } from '#server/platform/ai/agents';
import { defineAgent } from '#server/platform/definitions/define-agent';
import { observeAgentProgress } from '#server/platform/workflows/agent-progress';
import { WorkflowActivityOwner } from '#server/platform/workflows/ownership';
import { workflowStore } from '#server/platform/workflows/store';
import { App, serve } from '#server/runtime/index';

function controlledModel() {
  let finish!: () => void;
  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'stream',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('Streaming is required');
    },
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 'text' });
          controller.enqueue({ type: 'text-delta', id: 'text', delta: 'first' });
          finish = () => {
            controller.enqueue({ type: 'text-delta', id: 'text', delta: ' second' });
            controller.enqueue({ type: 'text-end', id: 'text' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 2, text: 2, reasoning: 0 }
              }
            });
            controller.close();
          };
        }
      })
    })
  };

  return { model, finish: () => finish() };
}

const definition = defineAgent({
  id: 'rpc-stream',
  customRules: [AgentRule.Replies],
  input: Schema.String,
  output: Schema.String,
  model: 'tiny',
  instructions: 'Reply',
  prompt: (input) => input
});

testStable(
  'HTTP streams intermediate agent snapshots, reseeds reconnects, and releases viewers without cancelling work',
  async () => {
    const location = createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);
    const executionId = executionIdSchema.make('rpc-agent');
    const owner = { executionId, ownerToken: 'owner', activityName: 'generate', attempt: 0 };
    const store = workflowStore(app.store);

    store.start(
      executionId,
      'reply',
      JSON.stringify({ event: { correlationId: 'rpc-request' } }),
      undefined
    );
    store.claim(executionId, owner.ownerToken);
    const observe = observeAgentProgress(app.store);
    const provider = controlledModel();
    const agents = layer({
      observe,
      model: () => Effect.succeed(provider.model),
      language: 'en',
      rules: Effect.succeed(defaultAgentRules),
      searchSources: () => Effect.succeed([])
    });
    let listeners = 0;
    const subscribe = app.store.subscribe.bind(app.store);

    app.store.subscribe = (listener) => {
      listeners++;
      const stop = subscribe(listener);

      return () => {
        listeners--;
        stop();
      };
    };

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const started = yield* Deferred.make<void>();
            const partial = yield* Deferred.make<void>();
            const fiber = yield* client['workflows.subscribeAgentProgress']({ executionId }).pipe(
              Stream.tap((runs) =>
                runs[0]?.text === 'first'
                  ? Deferred.succeed(partial, undefined)
                  : Deferred.succeed(started, undefined)
              ),
              Stream.takeUntil((runs) => runs[0]?.status === 'completed'),
              Stream.runCollect,
              Effect.forkChild
            );

            yield* Deferred.await(started);
            const generation = yield* generateAgent(definition, 'hello').pipe(
              Effect.provide(agents),
              Effect.provideService(WorkflowActivityOwner, owner),
              Effect.forkChild
            );

            yield* Deferred.await(partial).pipe(Effect.timeout('3 seconds'));
            const reseeded = yield* client['workflows.subscribeAgentProgress']({
              correlationId: 'rpc-request'
            }).pipe(Stream.take(1), Stream.runCollect);

            expect(reseeded[0]?.[0]).toMatchObject({ text: 'first', status: 'running' });
            provider.finish();
            expect(yield* Fiber.join(generation)).toBe('first second');
            const snapshots = yield* Fiber.join(fiber).pipe(Effect.timeout('3 seconds'));

            expect(snapshots[0]).toEqual([]);
            expect(snapshots.at(-1)?.[0]).toMatchObject({
              text: 'first second',
              status: 'completed'
            });
            expect(store.execution(executionId)?.status).toBe('running');
          })
        )
      );

      for (let i = 0; i < 100 && listeners; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));

      expect(listeners).toBe(0);
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);
