import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { test } from 'node:test';

import { Effect, Schema, Stream } from 'effect';

import { generateAgent, layer, streamAgent } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { defineAgent } from '#server/platform/definitions/define-agent';

const definition = defineAgent({
  id: 'reply',
  input: Schema.String,
  output: Schema.String,
  model: 'tiny',
  instructions: 'Reply',
  prompt: (input) => input
});

const objectDefinition = defineAgent({
  id: 'object',
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

function service(base: string, auth: AuthManager) {
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });

  return layer({
    model: () => Effect.succeed(model),
    language: 'en',
    searchSources: () => Effect.succeed([])
  });
}

test('generates validated output through the Responses provider', async () => {
  await peer(
    (_req, res) => send(res, 'Biology'),
    async (base, auth) => {
      assert.equal(
        await Effect.runPromise(
          generateAgent(definition, 'cells').pipe(Effect.provide(service(base, auth)))
        ),
        'Biology'
      );
    }
  );
});

test('rejects malformed structured output', async () => {
  await peer(
    (_req, res) => send(res, '{"count":"wrong"}'),
    async (base, auth) => {
      await assert.rejects(
        Effect.runPromise(
          generateAgent(objectDefinition, 'x').pipe(Effect.provide(service(base, auth)))
        )
      );
    }
  );
});

test('executes a source tool and sends its result back to the provider', async () => {
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
      const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
      const withTool = defineAgent({
        ...definition,
        tools: {
          sources: {
            description: 'Find sources',
            input: Schema.Struct({ query: Schema.String }),
            execute: (input, environment) =>
              environment.searchSources(
                Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }))(input).query
              )
          }
        }
      });
      const output = await Effect.runPromise(
        generateAgent(withTool, 'x').pipe(
          Effect.provide(
            layer({
              model: () => Effect.succeed(model),
              language: 'en',
              searchSources: (query) => {
                queries.push(query);

                return Effect.succeed([{ id: '1', name: 'notes', text: 'Cells use energy' }]);
              }
            })
          )
        )
      );

      assert.equal(output, 'Cells use energy.');
      assert.deepEqual(queries, ['cell']);
      assert.match(bodies[1], /Cells use energy/);
    }
  );
});

test('streams text before the provider completes and never completes a truncated response', async () => {
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
            searchSources: () => Effect.succeed([])
          })
        )
      )
    );
    const rejected = assert.rejects(running);

    try {
      await Promise.race([
        first,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error('delta was buffered')), 500)
        )
      ]);
      assert.deepEqual(seen, [{ type: 'text-delta', text: 'partial' }]);
    } finally {
      release();
    }

    await rejected;
    assert.deepEqual(seen, [{ type: 'text-delta', text: 'partial' }]);
  } finally {
    release();
    await auth.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('retries rate-limited requests up to the configured limit', async () => {
  let calls = 0;

  await peer(
    (_req, res) => {
      calls++;

      if (calls === 1) res.writeHead(429).end();
      else send(res, 'ok');
    },
    async (base, auth) => {
      assert.equal(
        await Effect.runPromise(
          generateAgent(definition, 'x', { maxRetries: 1 }).pipe(
            Effect.provide(service(base, auth))
          )
        ),
        'ok'
      );
      assert.equal(calls, 2);
    }
  );
});

test('cancellation after a delta never publishes completion', async () => {
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

        await assert.rejects(running);
        assert.deepEqual(seen, [{ type: 'text-delta', text: 'partial' }]);
      }
    );
  } finally {
    release();
  }
});

test('rejects empty model output without publishing completion', async () => {
  await peer(
    (_req, res) => send(res, ''),
    async (base, auth) => {
      const seen: unknown[] = [];

      await assert.rejects(
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
      );
      assert.equal(
        seen.some((event) => (event as { type: string }).type === 'complete'),
        false
      );
    }
  );
});

test('preserves conversation history in the native reply request', async () => {
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

      assert.equal(
        await Effect.runPromise(
          generateAgent(replyAgent, { messages }).pipe(Effect.provide(service(base, auth)))
        ),
        'read'
      );

      for (const value of ['Earlier request', 'Earlier answer', 'Read these'])
        assert.ok(body.includes(value));
    }
  );
});

test('transcribes image and PDF bytes through the native vision API', async () => {
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

        assert.equal(result.pages[0].blocks[0].text, 'read');
        assert.match(body, new RegExp(expected));
      }
    );
  }
});

test('rejects invalid request limits before making a provider request', async () => {
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

        assert.equal(error.kind, 'invalid_input');
      }

      assert.equal(calls, 0);
    }
  );
});

test('preserves the provider error kind and cause after retries are exhausted', async () => {
  await peer(
    (_req, res) => {
      res.writeHead(429).end();
    },
    async (base, auth) => {
      const error = await Effect.runPromise(
        Effect.flip(generateAgent(definition, 'x')).pipe(Effect.provide(service(base, auth)))
      );

      assert.equal(error.kind, 'rate_limited');
      assert.equal((error.cause as { name: string }).name, 'ChatGptRequestError');
    }
  );
});

test('canonical quiz agent accepts exactly one correct choice and rejects inconsistent answers', async () => {
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

      assert.equal((await run()).questions[0]?.kind, 'single_choice');
      validAnswer = false;
      await assert.rejects(run());
      assert.equal(requests, 2);
    }
  );
});

test('a model without request checks fails in the typed lane before provider work', async () => {
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
              searchSources: () => Effect.succeed([])
            })
          )
        )
      );

      assert.equal(failure.kind, 'unsupported');
      assert.equal(calls, 0);
    }
  );
});

test('slow consumers receive all large deltas and the validated completion', async () => {
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

      assert.equal(deltas.map((event) => event.text).join(''), delta.repeat(count));
      assert.deepEqual(events.at(-1), { type: 'complete', output: delta.repeat(count) });
    }
  );
});

test('never retries a failed response after publishing a delta', async () => {
  let calls = 0;

  await peer(
    (_req, res) => {
      calls++;
      send(res, 'partial', false);
    },
    async (base, auth) => {
      const seen: string[] = [];

      await assert.rejects(
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
      );
      assert.deepEqual(seen, ['text-delta']);
      assert.equal(calls, 1);
    }
  );
});

test('cancelling before the first delta closes the request without retries', async () => {
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
      await assert.rejects(running);
      await requestClosed;
      assert.equal(calls, 1);
    }
  );
});
