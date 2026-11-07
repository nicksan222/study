/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises validated agent generation and streaming against a local Responses API   │
 * │ peer. Coverage includes structured output, tool calls, provider failures, and            │
 * │ cancellation behavior.                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: generates validated output through the Responses provider; rejects malformed  │
 * │   structured output.                                                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Starts #server/platform/ai/agents, #server/platform/ai/providers/chatgpt/model,          │
 * │ #server/platform/ai/providers/chatgpt/session against a local HTTP peer; the test owns   │
 * │ and closes that peer.                                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AgentRule } from '@study/contracts/settings/schemas';
import { defaultAgentRules } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { Effect, Fiber, Schema, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { assert, expect } from 'vite-plus/test';

import { generateAgent, layer, streamAgent } from '#server/platform/ai/agents';
import type { AgentProgress, AgentsConfig } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { defineAgent, defineTool } from '#server/platform/definitions/define-agent';
import { createServerTest } from '#testing/server-test';

const definition = defineAgent({
  id: 'reply',
  customRules: [AgentRule.Replies],
  input: Schema.String,
  output: Schema.String,
  model: 'tiny',
  instructions: 'Reply',
  prompt: (input) => input
});

const objectDefinition = defineAgent({
  id: 'object',
  customRules: [AgentRule.Replies],
  input: Schema.String,
  output: Schema.Struct({ count: Schema.Number }),
  model: 'tiny',
  instructions: 'Count',
  prompt: (input) => input,
  mode: 'object'
});

function send(res: ServerResponse, text: string, finish = true) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });

  for (const event of [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } },
    { type: 'response.output_text.delta', item_id: 'm', delta: text },
    ...(finish ? [{ type: 'response.completed', response: {} }] : [])
  ])
    res.write(`data: ${JSON.stringify(event)}\n\n`);

  res.end();
}

async function peer(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>,
  run: (base: string, auth: AuthManager) => Promise<void>
) {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];

    for await (const chunk of req) chunks.push(chunk as Buffer);

    await handler(req, res, Buffer.concat(chunks).toString());
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
    await run(base, auth);
  } finally {
    await auth.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function service(base: string, auth: AuthManager, observe?: AgentsConfig['observe']) {
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });

  return layer({
    observe,
    model: () => Effect.succeed(model),
    language: 'en',
    rules: Effect.succeed(defaultAgentRules),
    searchSources: () => Effect.succeed([])
  });
}

testStable('generates validated output through the Responses provider', async () => {
  await peer(
    (_req, res) => send(res, 'Biology'),
    async (base, auth) => {
      assert.ok(
        (await Effect.runPromise(
          generateAgent(definition, 'cells').pipe(Effect.provide(service(base, auth)))
        )) === 'Biology'
      );
    }
  );
});

testStable('the harness publishes partial output before generation completes', async () => {
  let finish!: () => void;
  let sawDelta!: () => void;
  const partial = new Promise<void>((resolve) => {
    sawDelta = resolve;
  });
  const observed: string[] = [];
  const observe: NonNullable<AgentsConfig['observe']> = (observation) =>
    Effect.sync(() => {
      observed.push(observation.event.type);

      if (observation.event.type === 'text-delta') sawDelta();
    });

  await peer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } })}\n\n`
      );
      response.write(
        `data: ${JSON.stringify({ type: 'response.output_text.delta', item_id: 'm', delta: 'First' })}\n\n`
      );
      finish = () =>
        response.end(`data: ${JSON.stringify({ type: 'response.completed', response: {} })}\n\n`);
    },
    async (base, auth) => {
      let complete = false;
      const running = Effect.runPromise(
        generateAgent(definition, 'x').pipe(Effect.provide(service(base, auth, observe)))
      ).then((text) => {
        complete = true;

        return text;
      });

      try {
        await partial;
        expect(complete).toBe(false);
        expect(observed).toStrictEqual(['start', 'text-delta']);
      } finally {
        finish();
      }

      expect(await running).toBe('First');
      expect(observed).toStrictEqual(['start', 'text-delta', 'complete']);
    }
  );
});

testStable('rejects malformed structured output', async () => {
  await peer(
    (_req, res) => send(res, '{"count":"wrong"}'),
    async (base, auth) => {
      await expect(
        Effect.runPromise(
          generateAgent(objectDefinition, 'x').pipe(Effect.provide(service(base, auth)))
        )
      ).rejects.toThrow();
    }
  );
});

testStable(
  'batches preview writes without delaying direct deltas or losing the final text',
  async () => {
    let response!: ServerResponse;
    let sawFirst!: () => void;
    let sawDirectBurst!: () => void;
    const first = new Promise<void>((resolve) => {
      sawFirst = resolve;
    });
    const directBurst = new Promise<void>((resolve) => {
      sawDirectBurst = resolve;
    });
    const previews: string[] = [];
    const direct: string[] = [];
    const expected = `First${'x'.repeat(50)}`;
    const delta = (text: string) =>
      response.write(
        `data: ${JSON.stringify({ type: 'response.output_text.delta', item_id: 'm', delta: text })}\n\n`
      );
    const receive = (event: AgentProgress<string>) =>
      Effect.sync(() => {
        if (event.type !== 'text-delta') return;

        direct.push(event.text);

        if (direct.join('') === expected) sawDirectBurst();
      });
    const observe: NonNullable<AgentsConfig['observe']> = (observation) =>
      Effect.sync(() => {
        if (observation.event.type !== 'text-delta') return;

        previews.push(observation.event.text);

        if (previews.join('') === 'First') sawFirst();
      });
    const verify = Effect.gen(function* () {
      const running = yield* streamAgent(definition, 'x').pipe(
        Stream.tap(receive),
        Stream.runLast,
        Effect.forkChild
      );

      try {
        yield* Effect.promise(() => first);

        for (let i = 0; i < 50; i++) delta('x');

        // Synchronize with real SSE delivery before advancing the preview clock.
        yield* Effect.promise(() => directBurst);
        expect(previews).toEqual(['First']);
        expect(direct).toHaveLength(51);

        yield* TestClock.adjust('100 millis');
        expect(previews).toEqual(['First', 'x'.repeat(50)]);
      } finally {
        delta('tail');
        response.end(`data: ${JSON.stringify({ type: 'response.completed', response: {} })}\n\n`);
        yield* Fiber.join(running);
      }

      expect(previews.join('')).toBe(`${expected}tail`);
    });

    await peer(
      (_request, res) => {
        response = res;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } })}\n\n`
        );
        delta('First');
      },
      (base, auth) =>
        Effect.runPromise(
          verify.pipe(
            Effect.provide(service(base, auth, observe)),
            Effect.provide(TestClock.layer())
          )
        )
    );
  }
);

testStable('executes a source tool and sends its result back to the provider', async () => {
  const bodies: string[] = [];

  await peer(
    (_req, res, body) => {
      bodies.push(body);

      if (bodies.length !== 1) return send(res, 'Cells use energy.');

      const call = {
        type: 'function_call',
        id: 'item1',
        call_id: 'call1',
        name: 'sources',
        arguments: '{"query":"cell"}'
      };

      res.writeHead(200, { 'content-type': 'text/event-stream' });

      for (const event of [
        { type: 'response.output_item.added', output_index: 0, item: call },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { ...call, status: 'completed' }
        },
        { type: 'response.completed', response: {} }
      ])
        res.write(`data: ${JSON.stringify(event)}\n\n`);

      res.end();
    },
    async (base, auth) => {
      const queries: string[] = [];
      const observed: string[] = [];
      const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
      const withTool = defineAgent({
        ...definition,
        tools: {
          sources: defineTool({
            description: 'Find sources',
            wiki: {
              when: 'Find evidence.',
              examples: ['Find cells.'],
              limits: 'Captured sources only.'
            },
            output: Schema.Array(
              Schema.Struct({ id: Schema.String, name: Schema.String, text: Schema.String })
            ),
            mutates: false,
            input: Schema.Struct({ query: Schema.String }),
            execute: (input, environment) =>
              environment.searchSources(
                Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }))(input).query
              )
          })
        }
      });
      const output = await Effect.runPromise(
        generateAgent(withTool, 'x').pipe(
          Effect.provide(
            layer({
              observe: (observation) =>
                Effect.sync(() => {
                  observed.push(observation.event.type);
                }),
              model: () => Effect.succeed(model),
              language: 'en',
              rules: Effect.succeed(defaultAgentRules),
              searchSources: (query) => {
                queries.push(query);

                return Effect.succeed([{ id: '1', name: 'notes', text: 'Cells use energy' }]);
              }
            })
          )
        )
      );

      assert.ok(output === 'Cells use energy.');
      expect(queries).toStrictEqual(['cell']);
      expect(bodies[1]).toMatch(/Cells use energy/);
      expect(observed).toStrictEqual([
        'start',
        'tool-start',
        'tool-finish',
        'text-delta',
        'complete'
      ]);
    }
  );
});

testStable(
  'streams text before the provider completes and never completes a truncated response',
  async () => {
    const { createServer } = await import('node:http');
    const { Stream } = await import('effect');
    const { streamAgent } = await import('#server/platform/ai/agents');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = createServer(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });

      for (const event of [
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } },
        { type: 'response.output_text.delta', item_id: 'm', delta: 'partial' }
      ])
        res.write(`data: ${JSON.stringify(event)}\n\n`);

      await gate;
      res.end();
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
      const definition = defineAgent({
        id: 'reply',
        customRules: [AgentRule.Replies],
        input: Schema.String,
        output: Schema.String,
        model: 'tiny',
        instructions: 'Reply',
        prompt: (input) => input
      });
      const seen: unknown[] = [];
      let received!: () => void;
      const first = new Promise<void>((resolve) => {
        received = resolve;
      });
      const running = Effect.runPromise(
        streamAgent(definition, 'x').pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              seen.push(event);
              received();
            })
          ),
          Stream.runDrain,
          Effect.provide(
            layer({
              model: () => Effect.succeed(model),
              language: 'en',
              rules: Effect.succeed(defaultAgentRules),
              searchSources: () => Effect.succeed([])
            })
          )
        )
      );
      const rejected = (async () => {
        await expect(running).rejects.toThrow();
      })();

      try {
        await Promise.race([
          first,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(Error('delta was buffered')), 500)
          )
        ]);
        expect(seen).toStrictEqual([{ type: 'text-delta', text: 'partial' }]);
      } finally {
        release();
      }

      await rejected;
      expect(seen).toStrictEqual([{ type: 'text-delta', text: 'partial' }]);
    } finally {
      release();
      await auth.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
);

testStable('retries rate-limited requests up to the configured limit', async () => {
  let calls = 0;

  await peer(
    (_req, res) => {
      calls++;

      if (calls === 1) res.writeHead(429).end();
      else send(res, 'ok');
    },
    async (base, auth) => {
      assert.ok(
        (await Effect.runPromise(
          generateAgent(definition, 'x', { maxRetries: 1 }).pipe(
            Effect.provide(service(base, auth))
          )
        )) === 'ok'
      );
      assert.strictEqual(calls, 2);
    }
  );
});

testStable('cancellation after a delta never publishes completion', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: unknown[] = [];

  try {
    await peer(
      async (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });

        for (const event of [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'm' }
          },
          { type: 'response.output_text.delta', item_id: 'm', delta: 'partial' }
        ])
          res.write(`data: ${JSON.stringify(event)}\n\n`);

        await gate;
        res.end(`data: ${JSON.stringify({ type: 'response.completed', response: {} })}\n\n`);
      },
      async (base, auth) => {
        const controller = new AbortController();
        const running = Effect.runPromise(
          streamAgent(definition, 'x').pipe(
            Stream.tap((event) => {
              function recordAndAbort() {
                seen.push(event);
                controller.abort();
                release();
              }

              return Effect.sync(recordAndAbort);
            }),
            Stream.runDrain,
            Effect.provide(service(base, auth))
          ),
          { signal: controller.signal }
        );

        await expect(running).rejects.toThrow();
        expect(seen).toStrictEqual([{ type: 'text-delta', text: 'partial' }]);
      }
    );
  } finally {
    release();
  }
});

testStable('rejects empty model output without publishing completion', async () => {
  await peer(
    (_req, res) => send(res, ''),
    async (base, auth) => {
      const seen: unknown[] = [];

      await expect(
        Effect.runPromise(
          streamAgent(definition, 'x').pipe(
            Stream.tap((event) => {
              function recordEvent() {
                seen.push(event);
              }

              return Effect.sync(recordEvent);
            }),
            Stream.runDrain,
            Effect.provide(service(base, auth))
          )
        )
      ).rejects.toThrow();
      assert.ok(seen.some((event) => (event as { type: string }).type === 'complete') === false);
    }
  );
});

testStable('preserves conversation history in the native reply request', async () => {
  const { replyAgent } = await import('#server/features/conversations/agents/reply');
  let body = '';

  await peer(
    (_req, res, request) => {
      body = request;
      send(res, 'read');
    },
    async (base, auth) => {
      const messages = [
        { role: 'user' as const, content: 'Earlier request' },
        { role: 'assistant' as const, content: 'Earlier answer' },
        { role: 'user' as const, content: 'Read these' }
      ];

      assert.ok(
        (await Effect.runPromise(
          generateAgent(replyAgent, { messages }).pipe(Effect.provide(service(base, auth)))
        )) === 'read'
      );

      for (const value of ['Earlier request', 'Earlier answer', 'Read these'])
        assert.ok(body.includes(value));

      const request = JSON.parse(body);

      expect(request.tools).toContainEqual({ type: 'web_search' });
      expect(request.tools).toContainEqual(
        expect.objectContaining({ type: 'function', name: 'sources' })
      );
    }
  );
});

testStable('the Assistant keeps its local tools without gaining web search', async (t) => {
  const { assistantAgent } = await import('#server/features/conversations/agents/assistant');
  const fixture = createServerTest(t, { app: false });
  const store = new ServerContext(fixture.openDb());

  fixture.dispose(() => store.close());
  let body = '';

  await peer(
    (_req, res, request) => {
      body = request;
      send(res, 'Local answer');
    },
    async (base, auth) => {
      await Effect.runPromise(
        generateAgent(assistantAgent, {
          messages: [{ role: 'user', content: 'Search online' }]
        }).pipe(Effect.provide(service(base, auth)), Effect.provideService(Database, { store }))
      );
      const tools = JSON.parse(body).tools;

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.every((tool: { type: string }) => tool.type === 'function')).toBe(true);
    }
  );
});

testStable(
  'native web search completes inside the reply request without a local search executor',
  async () => {
    const { replyAgent } = await import('#server/features/conversations/agents/reply');
    const answer = 'Verified with [OpenAI](https://openai.com/).';
    let requests = 0;

    await peer(
      (_req, res) => {
        requests++;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const item = {
          type: 'web_search_call',
          id: 'search-1',
          status: 'completed',
          action: {
            type: 'search',
            query: 'OpenAI',
            sources: [{ type: 'url', url: 'https://openai.com/' }]
          }
        };

        for (const event of [
          { type: 'response.output_item.added', output_index: 0, item },
          { type: 'response.output_item.done', output_index: 0, item },
          {
            type: 'response.output_item.added',
            output_index: 1,
            item: { type: 'message', id: 'm' }
          },
          { type: 'response.output_text.delta', item_id: 'm', delta: answer },
          { type: 'response.completed', response: {} }
        ])
          res.write(`data: ${JSON.stringify(event)}\n\n`);

        res.end();
      },
      async (base, auth) => {
        expect(
          await Effect.runPromise(
            generateAgent(replyAgent, {
              messages: [{ role: 'user', content: 'Check online' }]
            }).pipe(Effect.provide(service(base, auth)))
          )
        ).toBe(answer);
        expect(requests).toBe(1);
      }
    );
  }
);

testStable('agents without a web search declaration never receive native web search', async () => {
  let body = '';

  await peer(
    (_req, res, request) => {
      body = request;
      send(res, 'Local answer');
    },
    async (base, auth) => {
      await Effect.runPromise(
        generateAgent(definition, 'Search online').pipe(Effect.provide(service(base, auth)))
      );
      expect(JSON.parse(body).tools ?? []).not.toContainEqual(
        expect.objectContaining({ type: 'web_search' })
      );
    }
  );
});

testStable('transcribes image and PDF bytes through the native vision API', async () => {
  const { visionTranscriptionAgent } =
    await import('#server/features/sources/agents/vision-transcription');

  for (const [_kind, mime, expected] of [
    ['image', 'image/png', 'input_image'],
    ['pdf', 'application/pdf', 'input_file']
  ] as const) {
    let body = '';

    await peer(
      (_req, res, request) => {
        body = request;
        send(
          res,
          JSON.stringify({ pages: [{ page: 1, blocks: [{ kind: 'paragraph', text: 'read' }] }] })
        );
      },
      async (base, auth) => {
        const result = await Effect.runPromise(
          generateAgent(visionTranscriptionAgent, {
            prompt: 'Transcribe page 1',
            data: new Uint8Array([1, 2, 3]),
            mediaType: mime
          }).pipe(Effect.provide(service(base, auth)))
        );

        assert.ok(result.pages[0].blocks[0].text === 'read');
        expect(body).toMatch(new RegExp(expected));
      }
    );
  }
});

testStable('rejects invalid request limits before making a provider request', async () => {
  let calls = 0;

  await peer(
    (_req, res) => {
      calls++;
      send(res, 'ok');
    },
    async (base, auth) => {
      for (const options of [
        { maxSteps: 0 },
        { maxSteps: 21 },
        { maxRetries: -1 },
        { maxRetries: 6 }
      ]) {
        const error = await Effect.runPromise(
          Effect.flip(generateAgent(definition, 'x', options)).pipe(
            Effect.provide(service(base, auth))
          )
        );

        assert.ok(error.kind === 'invalid_input');
      }

      assert.strictEqual(calls, 0);
    }
  );
});

testStable('preserves the provider error kind and cause after retries are exhausted', async () => {
  await peer(
    (_req, res) => {
      res.writeHead(429).end();
    },
    async (base, auth) => {
      const error = await Effect.runPromise(
        Effect.flip(generateAgent(definition, 'x')).pipe(Effect.provide(service(base, auth)))
      );

      assert.ok(error.kind === 'rate_limited');
      assert.ok((error.cause as { name: string }).name === 'ChatGptRequestError');
    }
  );
});

testStable(
  'canonical quiz agent accepts exactly one correct choice and rejects inconsistent answers',
  async () => {
    const { quizAgent } = await import('#server/features/materials/agents/quiz');
    let validAnswer = true;
    let requests = 0;

    await peer(
      (_req, res) => {
        requests++;
        send(
          res,
          JSON.stringify({
            kind: 'quiz',
            questions: [
              {
                kind: 'single_choice',
                prompt: 'q',
                choices: [
                  { text: 'a', isCorrect: validAnswer },
                  { text: 'b', isCorrect: false }
                ],
                explanation: 'e'
              }
            ]
          })
        );
      },
      async (base, auth) => {
        const run = () =>
          Effect.runPromise(
            generateAgent(quizAgent, { prompt: 'Ask a question' }).pipe(
              Effect.provide(service(base, auth))
            )
          );

        assert.ok((await run()).questions[0]?.kind === 'single_choice');
        validAnswer = false;
        await expect(run()).rejects.toThrow();
        assert.strictEqual(requests, 2);
      }
    );
  }
);

testStable(
  'a model without request checks fails in the typed lane before provider work',
  async () => {
    let calls = 0;

    await peer(
      (_req, res) => {
        calls++;
        send(res, 'unexpected');
      },
      async (base, auth) => {
        const { withRequestCheck: _check, ...model } = createChatGptModel({
          auth,
          modelId: 'test',
          baseUrl: base
        });
        const failure = await Effect.runPromise(
          Effect.flip(generateAgent(definition, 'question', { preflight: Effect.void })).pipe(
            Effect.provide(
              layer({
                model: () => Effect.succeed(model),
                language: 'en',
                rules: Effect.succeed(defaultAgentRules),
                searchSources: () => Effect.succeed([])
              })
            )
          )
        );

        assert.ok(failure.kind === 'unsupported');
        assert.strictEqual(calls, 0);
      }
    );
  }
);

testStable('slow consumers receive all large deltas and the validated completion', async () => {
  const delta = 'x'.repeat(4096);
  const count = 80;

  await peer(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } })}\n\n`
      );

      for (let i = 0; i < count; i++)
        res.write(
          `data: ${JSON.stringify({ type: 'response.output_text.delta', item_id: 'm', delta })}\n\n`
        );

      res.end(`data: ${JSON.stringify({ type: 'response.completed', response: {} })}\n\n`);
    },
    async (base, auth) => {
      const events = await Effect.runPromise(
        streamAgent(definition, 'x').pipe(
          Stream.tap(() => Effect.sleep('1 millis')),
          Stream.runCollect,
          Effect.provide(service(base, auth))
        )
      );
      const deltas = events.filter((event) => event.type === 'text-delta');

      assert.strictEqual(deltas.map((event) => event.text).join(''), delta.repeat(count));
      expect(events.at(-1)).toStrictEqual({ type: 'complete', output: delta.repeat(count) });
    }
  );
});

testStable('never retries a failed response after publishing a delta', async () => {
  let calls = 0;

  await peer(
    (_req, res) => {
      calls++;
      send(res, 'partial', false);
    },
    async (base, auth) => {
      const seen: string[] = [];

      await expect(
        Effect.runPromise(
          streamAgent(definition, 'x', { maxRetries: 3 }).pipe(
            Stream.tap((event) => {
              function recordEventType() {
                seen.push(event.type);
              }

              return Effect.sync(recordEventType);
            }),
            Stream.runDrain,
            Effect.provide(service(base, auth))
          )
        )
      ).rejects.toThrow();
      expect(seen).toStrictEqual(['text-delta']);
      assert.strictEqual(calls, 1);
    }
  );
});

testStable('cancelling before the first delta closes the request without retries', async () => {
  let calls = 0;
  let closed!: () => void;
  const requestClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });

  await peer(
    (_req, res) => {
      calls++;
      res.on('close', closed);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.flushHeaders();
    },
    async (base, auth) => {
      const controller = new AbortController();
      const running = Effect.runPromise(
        streamAgent(definition, 'x', { maxRetries: 3 }).pipe(
          Stream.runDrain,
          Effect.provide(service(base, auth))
        ),
        { signal: controller.signal }
      );

      while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 5));

      controller.abort();
      await expect(running).rejects.toThrow();
      await requestClosed;
      assert.strictEqual(calls, 1);
    }
  );
});

testStable('decoder exceptions remain typed input failures before provider work', async () => {
  const guarded = defineAgent({
    ...definition,
    input: Schema.Struct({ prompt: Schema.String }),
    prompt: (input) => input.prompt
  });
  const input = {
    get prompt(): string {
      throw new Error('private decoder failure');
    }
  };
  const failure = await Effect.runPromise(
    Effect.flip(generateAgent(guarded, input)).pipe(
      Effect.provide(
        layer({
          model: () => Effect.die(new Error('unexpected provider work')),
          language: 'en',
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        })
      )
    )
  );

  assert.ok(failure.kind === 'invalid_input');
  assert.ok(failure.message === 'Invalid agent input');
});

testStable(
  'injects only selected rules, composes title rules and reloads preferences for each run',
  async () => {
    let rules = {
      ...defaultAgentRules,
      quizzes: 'Use application questions.',
      titles: 'Use descriptive titles.',
      documents: 'UNRELATED DOCUMENT RULE'
    };
    const bodies: string[] = [];

    await peer(
      (_req, res, body) => {
        bodies.push(body);
        send(res, 'ok');
      },
      async (base, auth) => {
        const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
        const configured = layer({
          model: () => Effect.succeed(model),
          language: 'en',
          searchSources: () => Effect.succeed([]),
          rules: Effect.sync(() => rules)
        });
        const agent = defineAgent({
          ...definition,
          customRules: [AgentRule.Quizzes, AgentRule.Titles],
          instructions: (language) => `Base instructions in ${language}`
        });
        const run = () =>
          Effect.runPromise(generateAgent(agent, 'question').pipe(Effect.provide(configured)));

        await run();
        expect(bodies[0]).toContain('Base instructions in en');
        expect(bodies[0]).toContain('Use application questions.');
        expect(bodies[0]).toContain('Use descriptive titles.');
        expect(bodies[0]).not.toContain('UNRELATED DOCUMENT RULE');
        rules = { ...rules, quizzes: 'Updated quiz preference.', titles: '   ' };
        await run();
        expect(bodies[1]).toContain('Updated quiz preference.');
        expect(bodies[1]).not.toContain('Use application questions.');
        expect(bodies[1]).not.toContain('Use descriptive titles.');
        rules = defaultAgentRules;
        await run();
        expect(bodies[2]).not.toContain('User preferences');
        expect(bodies[2]).toContain('Base instructions in en');
      }
    );
  }
);
