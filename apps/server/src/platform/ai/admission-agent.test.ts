import { StudyError } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises AI admission at the agent boundary with a local Responses API peer. It   │
 * │ verifies queued calls defer preflight work and cancelled waiters never dispatch model    │
 * │ requests.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: queued agents cannot preflight or dispatch until admitted and cancelled       │
 * │   waiters never dispatch.                                                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Starts #server/platform/ai/agents, #server/platform/ai/providers/chatgpt/model,          │
 * │ #server/platform/ai/providers/chatgpt/session against a local HTTP peer; the test owns   │
 * │ and closes that peer.                                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { AgentRule } from '@study/contracts';
import { defaultAgentRules } from '@study/contracts';
import { test } from '@study/testing';
import { Deferred, Effect, Fiber, Schema } from 'effect';

import { generateAgent, layer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { defineAgent } from '#server/platform/definitions/define-agent';

test.stable(
  'queued agents cannot preflight or dispatch until admitted and cancelled waiters never dispatch',
  async () => {
    const entered = Effect.runSync(Deferred.make<void>());
    const responses: ((response: Response) => void)[] = [];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Promise<Response>((resolve) => {
          responses.push(resolve);

          if (responses.length === 2) Effect.runSync(Deferred.succeed(entered, undefined));
        })
    });

    test.assert.ok(server.port, 'missing address');
    const base = server.url.origin;
    const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

    try {
      await auth.replace(
        { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
        { accessToken: 'a', expiresIn: 3600 }
      );
      const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
      const agents = layer({
        model: () => Effect.succeed(model),
        language: 'en',
        rules: Effect.succeed(defaultAgentRules),
        searchSources: () => Effect.succeed([])
      });
      const definition = defineAgent({
        id: 'admission-test',
        customRules: [AgentRule.Replies],
        input: Schema.String,
        output: Schema.String,
        model: 'tiny',
        instructions: 'Reply',
        prompt: (input) => input
      });
      let queuedChecks = 0;

      await Effect.runPromise(
        Effect.gen(function* () {
          const run = (preflight: Effect.Effect<void, StudyError>) =>
            generateAgent(definition, 'hello', { preflight }).pipe(Effect.provide(agents));
          const first = yield* Effect.forkChild(run(Effect.void));
          const second = yield* Effect.forkChild(run(Effect.void));

          yield* Deferred.await(entered);
          const queued = yield* Effect.forkChild(
            run(
              Effect.sync(() => {
                queuedChecks++;
              })
            )
          );

          yield* Effect.yieldNow;
          yield* Fiber.interrupt(queued);
          test.assert.strictEqual(queuedChecks, 0);
          test.assert.strictEqual(responses.length, 2);
          const rejected = yield* Effect.forkChild(
            run(
              Effect.sync(() => {
                queuedChecks++;
              }).pipe(Effect.andThen(Effect.fail(new StudyError('cancelled', 'Stale request'))))
            )
          );

          yield* Effect.yieldNow;
          test.assert.strictEqual(queuedChecks, 0);

          for (const resolve of responses) {
            const events = [
              {
                type: 'response.output_item.added',
                output_index: 0,
                item: { type: 'message', id: 'm' }
              },
              { type: 'response.output_text.delta', item_id: 'm', delta: 'ok' },
              { type: 'response.completed', response: {} }
            ]
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join('');

            resolve(new Response(events, { headers: { 'content-type': 'text/event-stream' } }));
          }

          test.assert.strictEqual(yield* Fiber.join(first), 'ok');
          test.assert.strictEqual(yield* Fiber.join(second), 'ok');
          test.assert.ok((yield* Effect.flip(Fiber.join(rejected))).kind === 'cancelled');
          test.assert.strictEqual(queuedChecks, 1);
          test.assert.strictEqual(responses.length, 2);
        })
      );
    } finally {
      await auth.dispose();
      await server.stop(true);
    }
  }
);
