import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { test } from 'node:test';

import { StudyError } from '@study/contracts/errors';
import { Deferred, Effect, Fiber, Schema } from 'effect';

import { generateAgent, layer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { defineAgent } from '#server/platform/definitions/define-agent';

test('queued agents cannot preflight or dispatch until admitted and cancelled waiters never dispatch', async () => {
  const entered = Effect.runSync(Deferred.make<void>());
  const responses: ServerResponse[] = [];
  const server = createServer((_req, res) => {
    responses.push(res);

    if (responses.length === 2) Effect.runSync(Deferred.succeed(entered, undefined));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') throw Error('missing address');

  const base = `http://127.0.0.1:${address.port}`;
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
      searchSources: () => Effect.succeed([])
    });
    const definition = defineAgent({
      id: 'admission-test',
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
        assert.equal(queuedChecks, 0);
        assert.equal(responses.length, 2);
        const rejected = yield* Effect.forkChild(
          run(
            Effect.sync(() => {
              queuedChecks++;
            }).pipe(Effect.andThen(Effect.fail(new StudyError('cancelled', 'Stale request'))))
          )
        );

        yield* Effect.yieldNow;
        assert.equal(queuedChecks, 0);

        for (const res of responses) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });

          for (const event of [
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'message', id: 'm' }
            },
            { type: 'response.output_text.delta', item_id: 'm', delta: 'ok' },
            { type: 'response.completed', response: {} }
          ])
            res.write(`data: ${JSON.stringify(event)}\n\n`);

          res.end();
        }

        assert.equal(yield* Fiber.join(first), 'ok');
        assert.equal(yield* Fiber.join(second), 'ok');
        assert.equal((yield* Effect.flip(Fiber.join(rejected))).kind, 'cancelled');
        assert.equal(queuedChecks, 1);
        assert.equal(responses.length, 2);
      })
    );
  } finally {
    await auth.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
